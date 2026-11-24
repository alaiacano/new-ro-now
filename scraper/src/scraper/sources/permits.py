"""
Permit applications from New Rochelle's Municity 5 service (the data backend
behind the CitySquared portal).

The portal at citysquared.com is a Cloudflare-gated SPA, but the underlying
data service is a public, unauthenticated REST/WCF endpoint:

    https://services3.municity5.com/M5Services/M5Service.svc/Customer/NewRochelleCityNY/Application

That bulk endpoint returns *every* permit application citywide (~43k rows,
~52 MB). It ignores query params (no server-side filtering or paging) and the
per-record /Application/{id} route requires auth, so every sync pulls the full
list once and diffs it against our local SQLite database.

Storage: data/permits.db (gitignored) is the source of truth for querying.
Each row keeps curated, typed columns for fast queries PLUS the complete
original record in `raw_json` (481 fields) so nothing is ever lost — query the
long tail with SQLite's json_extract(raw_json, '$.FieldName').

A `status_history` table records every observed status change (with timestamp),
which is what powers timing analysis like "how long from submitted to approved,
and does it differ by applicant".

Three sync modes (all fetch the same full dump — the API offers no cheaper path):
  * full        — baseline load: upsert ALL rows. Run once, or to rebuild.
  * sync        — routine incremental: upsert ALL, report NEW applications and
                  status transitions since last run. Run this regularly.
  * update-open — targeted: only re-evaluate rows currently marked open and
                  report which ones got granted / issued / denied / closed.

Two JSON exports (both gitignored):
  * permits_public.json — no PII (address, type, status, dates, cost, location)
  * permits_full.json   — the above PLUS names/emails/phones
"""
import json
import sqlite3
from datetime import datetime, timezone

import httpx
from dateutil import parser as dateparser
from rich.console import Console
from rich.table import Table

from ..config import (
    MUNICITY_APPLICATIONS_URL,
    MUNICITY_HEADERS,
    PERMITS_DB_FILE,
    PERMITS_EXPORT_FULL,
    PERMITS_EXPORT_PUBLIC,
)

console = Console()

# ---------------------------------------------------------------------------
# Status classification
# ---------------------------------------------------------------------------
# Statuses (uppercased) that mean the application is decided/dead — i.e. NOT
# something "update-open" needs to keep watching. Everything else counts as open.
# Tweak these as you learn the city's vocabulary; is_open is recomputed each sync.
TERMINAL_STATUSES = {
    "APPROVED",
    "ISSUED PERMIT",
    "DENIED",
    "ABANDONED",
    "CANCELLED",
    "WITHDRAWN",
}


def _is_open(status: str | None) -> int:
    if not status:
        return 1  # blank/unknown → treat as still open so we keep watching it
    return 0 if status.strip().upper() in TERMINAL_STATUSES else 1


# ---------------------------------------------------------------------------
# Column mapping: (db_column, source_field, kind)
#   kind: text | int | real | date | cost
# raw_json keeps the full original record, so this is only the curated subset
# we want as first-class, fast-to-query columns.
# ---------------------------------------------------------------------------
CORE_COLUMNS: list[tuple[str, str, str]] = [
    ("application_id", "Application_ID", "int"),
    ("application_number", "ApplicationNumber", "text"),
    ("application_type", "ApplicationType", "text"),
    ("permit_application_type", "PermitApplicationType", "text"),
    ("department", "Department", "text"),
    ("status", "PermitApplicationStatus", "text"),
    ("status_raw", "Status", "text"),
    ("old_status", "OldPermitApplicationStatus", "text"),
    ("legal_address", "LegalAddress", "text"),
    ("addr1", "Addr1", "text"),
    ("master_sbl", "MasterSBL", "text"),
    ("sbl", "SBL", "text"),
    ("print_key", "PrintKey", "text"),
    ("parcel_zone", "ParcelZone", "text"),
    ("latitude", "Latitude", "real"),
    ("longitude", "Longitude", "real"),
    ("description", "Description", "text"),
    ("const_cost", "ConstCost", "text"),
    ("const_cost_num", "ConstCost", "cost"),
    ("total_cost", "TotalCost", "text"),
    ("application_date", "ApplicationDate", "date"),
    ("date_submitted", "DateSubmitted", "date"),
    ("created_date", "CreatedDate", "date"),
    ("approved_date", "ApprovedDate", "date"),
    ("closed_date", "ClosedDate", "date"),
    ("expires_date", "ExpiresDate", "date"),
    ("final_inspection_date", "FinalInspectionDate", "date"),
    ("status_updated", "PermitApplicationStatusUpdated", "date"),
    ("modified", "Modified", "date"),
    ("export_date", "ExportDate", "date"),
]

# PII columns — present in the DB and in permits_full.json, but excluded from
# permits_public.json.
PII_COLUMNS: list[tuple[str, str, str]] = [
    # NB: the populated applicant *name* lives in `Applicant`; the API's
    # `Applicant_Name` field is empty in this dataset.
    ("applicant", "Applicant", "text"),
    ("applicant_email", "Applicant_email", "text"),
    ("applicant_home_phone", "Applicant_Home_Phone", "text"),
    ("applicant_cell_phone", "Applicant_Cell_Phone", "text"),
    ("applicant_work_phone", "Applicant_Work_Phone", "text"),
    ("owner_name", "ParcelOwner_Name", "text"),
    ("owner_email", "ParcelOwner_MailingAddressEmail", "text"),
    ("owner_phone", "ParcelOwner_MailingAddressHomePhone", "text"),
    ("main_contact_name", "MainContactName", "text"),
    ("main_contact_email", "MainContactEmail", "text"),
    ("main_contact_phone", "MainContactPhone", "text"),
    ("approved_by", "ApprovedBy", "text"),
    ("closed_by", "ClosedBy", "text"),
    ("assigned_to", "AssignedTo", "text"),
    ("created_by", "CreatedBy", "text"),
    ("modified_by", "ModifiedBy", "text"),
    ("contact_id", "Contact_ID", "int"),
]

ALL_MAPPED = CORE_COLUMNS + PII_COLUMNS
# Derived/bookkeeping columns written by _row_values / _apply_records but not
# sourced 1:1 from a single API field.
EXTRA_COLUMNS = ["status_norm", "is_open", "raw_json", "first_seen", "last_seen", "status_changed_at"]
PUBLIC_EXPORT_COLUMNS = (
    [c[0] for c in CORE_COLUMNS] + ["status_norm", "is_open", "first_seen", "last_seen"]
)
FULL_EXPORT_COLUMNS = (
    [c[0] for c in ALL_MAPPED] + ["status_norm", "is_open", "first_seen", "last_seen"]
)


def _sql_type(kind: str) -> str:
    return {"int": "INTEGER", "real": "REAL", "cost": "REAL"}.get(kind, "TEXT")


# ---------------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------------
def _coerce(value, kind: str):
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if s == "" or s.upper() == "NULL":
            return None
    else:
        s = value
    if kind == "int":
        try:
            return int(s)
        except (ValueError, TypeError):
            return None
    if kind == "real":
        try:
            return float(s)
        except (ValueError, TypeError):
            return None
    if kind == "cost":
        try:
            return float(str(s).replace("$", "").replace(",", "").strip())
        except (ValueError, TypeError):
            return None
    if kind == "date":
        try:
            return dateparser.parse(str(s)).isoformat()
        except (ValueError, OverflowError, TypeError):
            return str(s)  # keep the raw string if unparseable
    return str(s)


def _iso_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(PERMITS_DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    col_defs = ",\n            ".join(
        f"{name} {_sql_type(kind)}" for name, _src, kind in ALL_MAPPED
    )
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS applications (
            {col_defs},
            status_norm       TEXT,
            is_open           INTEGER,
            raw_json          TEXT,
            first_seen        TEXT,
            last_seen         TEXT,
            status_changed_at TEXT,
            PRIMARY KEY (application_id)
        );

        CREATE TABLE IF NOT EXISTS status_history (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER REFERENCES applications(application_id),
            status         TEXT,
            observed_at    TEXT,
            note           TEXT
        );

        CREATE TABLE IF NOT EXISTS sync_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at        TEXT,
            mode          TEXT,
            fetched       INTEGER,
            inserted      INTEGER,
            status_changed INTEGER,
            duration_s    REAL
        );

        CREATE INDEX IF NOT EXISTS idx_app_status     ON applications(status_norm);
        CREATE INDEX IF NOT EXISTS idx_app_open       ON applications(is_open);
        CREATE INDEX IF NOT EXISTS idx_app_dept       ON applications(department);
        CREATE INDEX IF NOT EXISTS idx_app_type       ON applications(application_type);
        CREATE INDEX IF NOT EXISTS idx_app_appdate    ON applications(application_date);
        CREATE INDEX IF NOT EXISTS idx_app_owner      ON applications(owner_name);
        CREATE INDEX IF NOT EXISTS idx_app_applicant  ON applications(applicant);
        CREATE INDEX IF NOT EXISTS idx_hist_app       ON status_history(application_id);
        """
    )


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------
def fetch_applications() -> list[dict]:
    """Pull the full citywide application list (~52 MB). One request, no paging."""
    console.print("[dim]Fetching full application list from Municity 5 (~52 MB)…[/dim]")
    with httpx.Client(timeout=httpx.Timeout(300.0), headers=MUNICITY_HEADERS) as client:
        resp = client.get(MUNICITY_APPLICATIONS_URL)
        resp.raise_for_status()
        data = resp.json()
    console.print(f"[green]✓[/green] fetched {len(data):,} application records")
    return data


# ---------------------------------------------------------------------------
# Sync core
# ---------------------------------------------------------------------------
def _row_values(rec: dict) -> dict:
    """Map a raw API record to our curated column values."""
    out = {}
    for name, src, kind in ALL_MAPPED:
        out[name] = _coerce(rec.get(src), kind)
    status = rec.get("PermitApplicationStatus")
    out["status_norm"] = status.strip().upper() if isinstance(status, str) and status.strip() else None
    out["is_open"] = _is_open(status)
    # Store only populated fields in raw_json. Each API record has 481 fields,
    # most empty (e.g. ~112 always-null Permit{N}UserDefined columns), which would
    # bloat the DB ~10x. Dropping null/blank keys is lossless for json_extract
    # (an absent key and a null key both extract to NULL) and keeps every field
    # that actually carries data fully queryable.
    pruned = {
        k: v
        for k, v in rec.items()
        if v is not None and not (isinstance(v, str) and v.strip() in ("", "NULL"))
    }
    out["raw_json"] = json.dumps(pruned, default=str, separators=(",", ":"))
    return out


def _apply_records(conn: sqlite3.Connection, records: list[dict], *, mode: str) -> dict:
    """
    Upsert records and record status changes.

    mode:
      full / sync  — upsert everything (sync additionally surfaces deltas).
      update-open  — only touch rows already present AND currently open.
    """
    now = _iso_now()
    existing = {
        r["application_id"]: (r["status"], r["is_open"])
        for r in conn.execute("SELECT application_id, status, is_open FROM applications")
    }

    col_names = [c[0] for c in ALL_MAPPED] + EXTRA_COLUMNS
    placeholders = ",".join(f":{c}" for c in col_names)
    insert_sql = (
        f"INSERT INTO applications ({','.join(col_names)}) VALUES ({placeholders})"
    )
    # On conflict, refresh everything except first_seen.
    update_cols = [c for c in col_names if c != "first_seen"]
    update_sql = (
        "UPDATE applications SET "
        + ",".join(f"{c}=:{c}" for c in update_cols)
        + " WHERE application_id=:application_id"
    )
    # Same update, but leaves status_changed_at untouched (used when status is
    # unchanged so we preserve when the status *last* actually changed).
    update_cols_keep_sca = [c for c in update_cols if c != "status_changed_at"]
    update_sql_keep_sca = (
        "UPDATE applications SET "
        + ",".join(f"{c}=:{c}" for c in update_cols_keep_sca)
        + " WHERE application_id=:application_id"
    )

    inserted = 0
    status_changed = 0
    skipped = 0
    transitions: list[tuple] = []  # (app_id, old, new, address)

    for rec in records:
        aid = rec.get("Application_ID")
        if aid is None:
            continue
        prev = existing.get(aid)

        if mode == "update-open":
            # Only re-evaluate things we already track that were still open.
            if prev is None or prev[1] == 0:
                skipped += 1
                continue

        vals = _row_values(rec)
        new_status = vals["status"]

        if prev is None:
            vals["first_seen"] = now
            vals["last_seen"] = now
            vals["status_changed_at"] = now
            conn.execute(insert_sql, vals)
            conn.execute(
                "INSERT INTO status_history (application_id, status, observed_at, note) "
                "VALUES (?,?,?,?)",
                (aid, new_status, now, "new"),
            )
            inserted += 1
        else:
            old_status = prev[0]
            changed = (old_status or "") != (new_status or "")
            vals["last_seen"] = now
            if changed:
                vals["status_changed_at"] = now
                conn.execute(update_sql, vals)
                conn.execute(
                    "INSERT INTO status_history (application_id, status, observed_at, note) "
                    "VALUES (?,?,?,?)",
                    (aid, new_status, now, f"changed from {old_status!r}"),
                )
                status_changed += 1
                transitions.append(
                    (aid, old_status, new_status, vals.get("legal_address") or vals.get("addr1"))
                )
            else:
                # status unchanged: refresh fields but DON'T clobber status_changed_at
                conn.execute(update_sql_keep_sca, vals)

    duration = None
    conn.execute(
        "INSERT INTO sync_log (ran_at, mode, fetched, inserted, status_changed, duration_s) "
        "VALUES (?,?,?,?,?,?)",
        (now, mode, len(records), inserted, status_changed, duration),
    )
    conn.commit()
    return {
        "fetched": len(records),
        "inserted": inserted,
        "status_changed": status_changed,
        "skipped": skipped,
        "transitions": transitions,
    }


def _run(mode: str) -> dict:
    start = datetime.now(tz=timezone.utc)
    conn = get_conn()
    init_db(conn)
    records = fetch_applications()
    stats = _apply_records(conn, records, mode=mode)
    # backfill duration on the just-written log row
    dur = (datetime.now(tz=timezone.utc) - start).total_seconds()
    conn.execute(
        "UPDATE sync_log SET duration_s=? WHERE id=(SELECT MAX(id) FROM sync_log)", (dur,)
    )
    conn.commit()
    conn.close()
    return stats


# ---------------------------------------------------------------------------
# Public command entry points
# ---------------------------------------------------------------------------
def sync_full() -> dict:
    """Baseline load / full rebuild: upsert every application."""
    stats = _run("full")
    console.print(
        f"[green]✓[/green] full sync: {stats['inserted']:,} new, "
        f"{stats['status_changed']:,} status changes "
        f"(of {stats['fetched']:,} fetched)"
    )
    return stats


def sync_incremental() -> dict:
    """Routine pass: upsert all, surface new applications + status transitions."""
    stats = _run("sync")
    console.print(
        f"[green]✓[/green] sync: {stats['inserted']:,} new applications, "
        f"{stats['status_changed']:,} status changes"
    )
    _print_transitions(stats["transitions"])
    return stats


def sync_update_open() -> dict:
    """Targeted: re-check only currently-open applications for a decision."""
    stats = _run("update-open")
    console.print(
        f"[green]✓[/green] update-open: {stats['status_changed']:,} of the open "
        f"applications changed status ({stats['skipped']:,} non-open skipped)"
    )
    _print_transitions(stats["transitions"])
    return stats


def _print_transitions(transitions: list[tuple], limit: int = 40) -> None:
    if not transitions:
        return
    table = Table(title=f"Status transitions ({len(transitions)})", show_lines=False)
    table.add_column("App ID", justify="right")
    table.add_column("From")
    table.add_column("To")
    table.add_column("Address")
    for aid, old, new, addr in transitions[:limit]:
        table.add_row(str(aid), old or "—", new or "—", addr or "—")
    console.print(table)
    if len(transitions) > limit:
        console.print(f"[dim]… and {len(transitions) - limit} more[/dim]")


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def export_json() -> dict:
    """Write permits_public.json (no PII) and permits_full.json (with PII)."""
    conn = get_conn()
    init_db(conn)

    def dump(columns: list[str], path) -> int:
        rows = conn.execute(
            f"SELECT {','.join(columns)} FROM applications ORDER BY application_id"
        ).fetchall()
        data = [dict(r) for r in rows]
        path.write_text(json.dumps(data, default=str))
        return len(data)

    n_public = dump(PUBLIC_EXPORT_COLUMNS, PERMITS_EXPORT_PUBLIC)
    n_full = dump(FULL_EXPORT_COLUMNS, PERMITS_EXPORT_FULL)
    conn.close()
    console.print(
        f"[green]✓[/green] exported {n_public:,} rows → "
        f"{PERMITS_EXPORT_PUBLIC.name} (no PII) and {PERMITS_EXPORT_FULL.name} (with PII)"
    )
    return {"public": n_public, "full": n_full}


# ---------------------------------------------------------------------------
# Ad-hoc querying helpers
# ---------------------------------------------------------------------------
def run_query(sql: str, limit: int = 50) -> None:
    """Run arbitrary read-only SQL and print a table."""
    conn = get_conn()
    init_db(conn)
    rows = conn.execute(sql).fetchall()
    conn.close()
    if not rows:
        console.print("[yellow]no rows[/yellow]")
        return
    table = Table(show_lines=False)
    for col in rows[0].keys():
        table.add_column(col)
    for r in rows[:limit]:
        table.add_row(*[("" if v is None else str(v)) for v in r])
    console.print(table)
    console.print(f"[dim]{len(rows)} row(s); showing {min(limit, len(rows))}[/dim]")


def print_stats() -> None:
    """Summary of what's in the database."""
    conn = get_conn()
    init_db(conn)
    total = conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0]
    open_n = conn.execute("SELECT COUNT(*) FROM applications WHERE is_open=1").fetchone()[0]
    dr = conn.execute(
        "SELECT MIN(application_date), MAX(application_date) FROM applications "
        "WHERE application_date IS NOT NULL"
    ).fetchone()
    console.print(f"[bold]{total:,}[/bold] applications  |  [bold]{open_n:,}[/bold] open")
    console.print(f"application_date range: {dr[0]} → {dr[1]}")

    console.print("\n[bold]By status[/bold]")
    run_query(
        "SELECT status, COUNT(*) AS n FROM applications "
        "GROUP BY status ORDER BY n DESC", limit=30
    )
    console.print("\n[bold]By department (top 15)[/bold]")
    run_query(
        "SELECT department, COUNT(*) AS n FROM applications "
        "GROUP BY department ORDER BY n DESC LIMIT 15", limit=15
    )
    last = conn.execute(
        "SELECT ran_at, mode, fetched, inserted, status_changed, duration_s "
        "FROM sync_log ORDER BY id DESC LIMIT 5"
    ).fetchall()
    if last:
        console.print("\n[bold]Recent syncs[/bold]")
        t = Table()
        for c in ["ran_at", "mode", "fetched", "inserted", "status_changed", "duration_s"]:
            t.add_column(c)
        for r in last:
            t.add_row(*[str(r[c]) for c in r.keys()])
        console.print(t)
    conn.close()
