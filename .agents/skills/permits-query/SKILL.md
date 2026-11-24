---
name: permits-query
description: Query the New Rochelle permits database (data/permits.db) — building/electrical/plumbing/DPW permit applications scraped from the Municity 5 API. Use when asked to analyze permits, look up an address/parcel/applicant/owner, compute approval or denial rates, investigate whether some applicants are treated better than others, or run any SQL against permits.db. Knows the schema, which columns are populated vs empty, the status vocabulary, and ready-made analysis queries.
---

# Querying permits.db

`data/permits.db` is a local, **gitignored** SQLite database of every permit
application in New Rochelle, NY (~42,900 rows), pulled from the public Municity 5
service behind the CitySquared portal. It is the source of truth for permit
analysis. Source/scraper: `scraper/src/scraper/sources/permits.py`.

## How to query

Two equivalent ways — both read-only is your responsibility (don't UPDATE/DELETE):

```bash
# Built-in CLI (pretty rich table, caps display rows with -n):
uv run --project scraper scrape permits query "SELECT ... " -n 50

# Direct sqlite3 (better for CSV/large output, scripting, json_extract):
sqlite3 data/permits.db "SELECT ... ;"

# Summary dashboard:
uv run --project scraper scrape permits stats
```

For ad-hoc analysis prefer `sqlite3` with `-header -column` or `-csv`. The DB is
indexed on: `status_norm`, `is_open`, `department`, `application_type`,
`application_date`, `owner_name`, `applicant`.

## Tables

- **`applications`** — one row per permit application, PK `application_id`.
  Curated typed columns (below) + `raw_json` (the full original record) +
  bookkeeping (`first_seen`, `last_seen`, `status_changed_at`).
- **`status_history`** — `(application_id, status, observed_at, note)`. One row
  per *observed* status change. Seeded with each app's status at first sync;
  grows as `scrape permits sync` detects transitions over time. This is the only
  source of real status-change *timing* (see caveats).
- **`sync_log`** — one row per sync run (`mode`, `fetched`, `inserted`,
  `status_changed`, `duration_s`).

## Columns that matter (and how populated)

Identity / location:
| column | pop. | notes |
|---|---|---|
| `application_id` | 100% | PK, sequential, ~236–54000+ |
| `application_number` | 99% | human-facing number (not unique over time) |
| `application_type` / `permit_application_type` | 100% | e.g. "Electrical Renovations or Alterations" |
| `department` | 91% | Buildings, Public Works Permit, Buildings - Electrical/Plumbing/Sign, Development… |
| `legal_address` / `addr1` | 99% / 96% | street address |
| `master_sbl` / `sbl` / `print_key` | 60–91% | parcel/tax IDs (`print_key` most populated) |
| `parcel_zone` | 57% | e.g. R1-10, R1-15 |
| `latitude` / `longitude` | 61% | only ~61% geocoded — filter `latitude IS NOT NULL` for maps |

Status:
| column | pop. | notes |
|---|---|---|
| `status` | 93% | raw, case-inconsistent (Abandoned vs ABANDONED) |
| **`status_norm`** | 93% | **uppercased/trimmed — GROUP BY this, not `status`** |
| `is_open` | 100% | 1 = still in process, 0 = decided/dead (see terminal set) |
| `old_status` | — | usually null |

Dates (all stored ISO-8601 text; compare with string `>`/`<` or `julianday()`):
| column | pop. | notes |
|---|---|---|
| `application_date` | 92% | best "when filed" |
| `date_submitted` | 70% | submission timestamp |
| `created_date` | 97% | record creation |
| `modified` | 72% | last touch — rough proxy for last status action |
| `approved_date`, `closed_date`, `status_updated`, `final_inspection_date`, `expires_date` | **EMPTY** | the API does not populate decision dates — see caveats |

Cost:
| column | pop. | notes |
|---|---|---|
| `const_cost` | text | raw, may be "$600", "NULL", etc. |
| **`const_cost_num`** | 59% | parsed REAL — use for math |
| `total_cost` | text | often null |

People / PII (in DB + `permits_full.json`, excluded from `permits_public.json`):
| column | pop. | notes |
|---|---|---|
| **`applicant`** | 74% | applicant **name** (NB: `Applicant_Name` in the API is empty; name lives here) |
| `owner_name` | 56% | parcel owner |
| `assigned_to` | 75% | city staff email handling it (e.g. NRElectrical@newrochelleny.gov) |
| `contact_id` | 80% | internal contact id |
| `applicant_email`, `owner_email`, `owner_phone`, `main_contact_*`, `approved_by`, `closed_by` | **EMPTY** | not populated by the bulk dump |

## Status vocabulary (`status_norm`)

Decided/dead (`is_open = 0`), the `TERMINAL_STATUSES` set in code:
`APPROVED`, `ISSUED PERMIT`, `DENIED`, `ABANDONED`, `CANCELLED`, `WITHDRAWN`.

Still open (`is_open = 1`): `SUBMITTED`, `DRAFT`, `IN REVIEW`, `PENDING`,
`PENDING BOARD APPROVAL`, `PENDING PAYMENT`, `PAID`, `H2M REVIEW`, blank/unknown.

Counts as of last sync: APPROVED ~17k, ISSUED PERMIT ~11k, ABANDONED ~4.5k,
SUBMITTED ~3.2k, blank ~2.9k, DRAFT ~1.2k, CANCELLED ~1.2k, IN REVIEW ~0.8k,
WITHDRAWN ~0.65k, then small tails. "Granted" ≈ `status_norm IN ('APPROVED','ISSUED PERMIT','PAID')`.

## The long tail: `raw_json`

Each row keeps the full original API record (pruned to populated fields) in
`raw_json`. The curated columns are the useful ~25 of 481 fields; pull anything
else with `json_extract`:

```sql
SELECT application_id,
       json_extract(raw_json,'$.PermitCreated')      AS permit_created,
       json_extract(raw_json,'$.Inventory_EnclosedPorch') AS porch
FROM applications
WHERE json_extract(raw_json,'$.PermitCreated') IS NOT NULL
LIMIT 5;
```

To discover field names: `SELECT DISTINCT key FROM applications, json_each(applications.raw_json) LIMIT 200;`

## The headline analysis goal

The owner suspects **some applicants are treated better/faster than others**.
Approval/denial/abandonment **rates** are answerable now. Approval **speed** is
only weakly retrospective (decision dates are empty) and accrues precisely going
forward via `status_history`.

```sql
-- Grant vs death rate by high-volume applicant (recent)
SELECT applicant,
       COUNT(*) AS apps,
       ROUND(100.0*SUM(status_norm IN ('APPROVED','ISSUED PERMIT','PAID'))/COUNT(*),0) AS pct_granted,
       SUM(status_norm IN ('ABANDONED','CANCELLED','WITHDRAWN','DENIED'))               AS dead,
       SUM(status_norm = 'DENIED')                                                      AS denied
FROM applications
WHERE applicant IS NOT NULL AND application_date > '2022-01-01'
GROUP BY applicant
HAVING apps >= 15
ORDER BY pct_granted ASC;        -- worst-treated first

-- Denial/abandon rate by zone (are some neighborhoods scrutinized harder?)
SELECT parcel_zone,
       COUNT(*) AS apps,
       ROUND(100.0*SUM(status_norm IN ('DENIED','ABANDONED','WITHDRAWN'))/COUNT(*),1) AS pct_dead
FROM applications
WHERE parcel_zone IS NOT NULL
GROUP BY parcel_zone HAVING apps >= 30 ORDER BY pct_dead DESC;

-- Rough turnaround proxy (no decision dates: use modified - submitted)
SELECT department, COUNT(*) n,
       ROUND(AVG(julianday(modified) - julianday(date_submitted)),1) AS avg_days
FROM applications
WHERE date_submitted IS NOT NULL AND modified IS NOT NULL
  AND julianday(modified) >= julianday(date_submitted)
  AND date_submitted > '2024-01-01'
GROUP BY department ORDER BY n DESC;

-- Precise transition timing once history has accumulated across syncs
SELECT a.applicant, a.application_id,
       MIN(CASE WHEN h.status='Submitted'      THEN h.observed_at END) AS submitted_at,
       MIN(CASE WHEN h.status IN ('APPROVED','ISSUED PERMIT') THEN h.observed_at END) AS granted_at
FROM applications a JOIN status_history h USING(application_id)
GROUP BY a.application_id HAVING granted_at IS NOT NULL;
```

Other common lookups:

```sql
-- Everything at one address
SELECT application_id, application_type, status_norm, application_date, applicant, const_cost_num
FROM applications WHERE legal_address LIKE '%Beechmont%' ORDER BY application_date DESC;

-- Currently open work, newest first
SELECT application_id, application_type, status, application_date, legal_address, applicant
FROM applications WHERE is_open = 1 ORDER BY application_date DESC LIMIT 50;
```

## Caveats / gotchas (read before trusting a result)

- **No decision dates.** `approved_date`/`closed_date`/`status_updated` are empty
  in the source. You cannot get historical "days to approval" precisely — only
  the `modified - date_submitted` proxy, or forward-looking `status_history`.
- **Group by `status_norm`, not `status`** — raw status mixes case (Abandoned/ABANDONED).
- **One junk status** exists (an email address as a status value, 1 row) — a data-entry error upstream; filter it if it skews a status breakdown.
- **Costs are text in `const_cost`**; use `const_cost_num` for arithmetic, and it's only ~59% populated.
- **~39% of rows have no lat/long** — always filter `latitude IS NOT NULL` for mapping or you'll silently drop them.
- **`application_number` is not a stable unique key** across years; use `application_id`.
- **Dates are mostly `YYYY-MM-DDTHH:MM:SS` strings** so lexical comparison works, but a few may be raw unparseable strings — guard with `julianday(x) IS NOT NULL` in math.
- **PII reality:** only `applicant` (name), `owner_name`, and `assigned_to` (staff email) carry person data; all other email/phone columns are empty.

## Refreshing the data

The DB is a point-in-time mirror. To update before analysis (each pulls the full
~52 MB dump, ~60–90s):

```bash
make permits-sync      # add new apps + record status transitions (routine)
make permits-open      # re-check only currently-open apps for a decision
make permits-full      # full rebuild from scratch
```

Check freshness: `SELECT * FROM sync_log ORDER BY id DESC LIMIT 3;`
