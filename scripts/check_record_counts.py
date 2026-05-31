#!/usr/bin/env python3
"""Guard against catastrophic data loss in the scraping pipeline.

Usage:
    scripts/check_record_counts.py snapshot   # record current counts
    scripts/check_record_counts.py check      # fail (exit 1) if any count dropped

`snapshot` writes data/.record_counts.json with {filename: count} for every
data/*.json file (list length, or dict key count for geocache.json; meta.json
is skipped because it tracks timestamps, not records).

`check` reloads the snapshot, recounts the current files, and exits non-zero
if ANY file has fewer records than at snapshot time -- or is missing entirely.

Note on legitimate churn: some sources (meetings 6mo window, news last 30,
public_hearings last 12mo) can naturally lose a few records between runs.
This check is strict because the goal is to catch "agent nuked the data"
(N -> 0), not normal aging. If a small expected drop trips it, re-snapshot
after confirming the new counts are correct.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SNAPSHOT_FILE = DATA_DIR / ".record_counts.json"

# meta.json holds per-source timestamps, not records — counting it is meaningless.
SKIP = {"meta.json", ".record_counts.json"}


def count_records(path: Path) -> int | None:
    """Return record count for a JSON file, or None if shape is uncountable."""
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    if isinstance(data, (list, dict)):
        return len(data)
    return None


def current_counts() -> dict[str, int]:
    counts: dict[str, int] = {}
    for path in sorted(DATA_DIR.glob("*.json")):
        if path.name in SKIP:
            continue
        n = count_records(path)
        if n is not None:
            counts[path.name] = n
    return counts


def cmd_snapshot() -> int:
    counts = current_counts()
    SNAPSHOT_FILE.write_text(json.dumps(counts, indent=2, sort_keys=True) + "\n")
    print(f"Snapshot: {len(counts)} files -> {SNAPSHOT_FILE.relative_to(REPO_ROOT)}")
    for name, n in counts.items():
        print(f"  {name}: {n}")
    return 0


def cmd_check() -> int:
    if not SNAPSHOT_FILE.exists():
        print(f"ERROR: no snapshot at {SNAPSHOT_FILE.relative_to(REPO_ROOT)}.")
        print("Run `make snapshot` (or this script with `snapshot`) before checking.")
        return 2
    before: dict[str, int] = json.loads(SNAPSHOT_FILE.read_text())
    after = current_counts()

    regressions: list[tuple[str, int, int | None]] = []
    for name, n_before in before.items():
        n_after = after.get(name)
        if n_after is None:
            regressions.append((name, n_before, None))
        elif n_after < n_before:
            regressions.append((name, n_before, n_after))

    if regressions:
        print("FAIL: record count regressed in one or more files:")
        for name, b, a in regressions:
            shown = "MISSING" if a is None else str(a)
            print(f"  {name}: {b} -> {shown}")
        print()
        print(f"Snapshot: {SNAPSHOT_FILE.relative_to(REPO_ROOT)}")
        print("If the drop is expected (e.g. expired meetings), re-snapshot after review.")
        return 1

    print(f"OK: all {len(before)} tracked files held or grew their record counts.")
    for name, n_before in sorted(before.items()):
        n_after = after[name]
        delta = n_after - n_before
        sign = "+" if delta > 0 else " "
        print(f"  {name}: {n_before} -> {n_after} ({sign}{delta})")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] not in {"snapshot", "check"}:
        print(__doc__, file=sys.stderr)
        return 2
    return cmd_snapshot() if argv[1] == "snapshot" else cmd_check()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
