---
name: new-ro-now-weekly-update
description: Refresh New Rochelle civic data by running the scrape pipeline with the data-loss guard. Snapshots record counts, runs Pipeline A (live scrapers) and Pipeline B (DocumentCenter mirror), then verifies no file shrunk. Does NOT touch git — the caller handles pull/commit/push.
---

# Weekly Update

## What this skill does

1. Snapshot current record counts in every `data/*.json`.
2. Run all scrapers (Pipeline A + Pipeline B).
3. Verify no file ended up with fewer records than the snapshot.

If the verify step fails, **stop and report the failure**. Do not retry. Do not modify `data/`. The caller decides recovery.

## What this skill does NOT do

- It does not `git pull`, `git commit`, or `git push`. The caller (cron prompt) handles git.
- It does not build the web frontend. GitHub Actions does that on push.
- It does not delete or restore files under `data/`.

## Working directory

Always run from the repo root: `/Users/alaiacano/dev/github/alaiacano/new-ro-monitor`

## Prerequisites (one-time per machine)

```bash
cd scraper && uv sync
playwright install chromium
```

For Pipeline B (`analyze` stage), a vLLM server must be reachable. Defaults in the Makefile assume `http://localhost:8000/v1`. Override via env vars if needed:

```bash
export VLLM_URL=http://spark-2c6d.local:8000/v1
export VLLM_MODEL=qwen36-35b
```

## How to run

**One command. Use this.**

```bash
make all
```

This target automatically:
- runs `make snapshot` (writes `data/.record_counts.json`)
- runs every Pipeline A scraper (meetings, construction, paving, library, bids, news)
- runs Pipeline B sequentially (discover → download → analyze → export-docs)
- runs `make check` at the end

If you do not have vLLM available, run `make quick` instead — Pipeline A only, no document analysis.

**Never run `uv run --project scraper scrape …` directly.** That bypasses the snapshot and check, which is exactly how the data was lost previously.

## What success looks like

The final lines of `make all` output will look like:

```
OK: all 13 tracked files held or grew their record counts.
  bids.json: 4 -> 5 (+1)
  construction.json: 14 -> 14 ( 0)
  ...
```

If you see this, the run succeeded. Report success to the caller.

## What failure looks like — WARN LOUDLY

If `make check` fails, the output will include:

```
FAIL: record count regressed in one or more files:
  meetings.json: 41 -> 0
  bids.json: 4 -> 0
```

When this happens:

1. **Do not commit anything.** Do not push. Do not run `make` again to "try once more".
2. **Do not touch `data/`.** The existing JSON files on disk are now the bad (shrunk) version — but the *git-committed* versions are still good, and the caller will decide whether to `git restore` them.
3. **Report the full FAIL block to the caller verbatim**, including every file:before:after line. The caller needs this to decide recovery.
4. **Note the likely cause**: a source went temporarily empty (city site down, network error, scraper bug) and the scraper overwrote real data with `[]`. This is a known bug in the scraper — it writes unconditionally even when fetched data is empty. The check catches it; recovery is by `git restore data/<file>.json` from the caller side.

## Critical safety rules

Never run any of these against `data/`:

- `rm`, `rm -rf`, `find … -delete`
- `git checkout -- data/`, `git restore data/` (the caller may do this; the skill must not)
- `git reset --hard`, `git clean -fd`
- Manual edits to `data/*.json`, `data/documents.db`, `data/doc_cache/`, or `data/geocache.json`

Never bypass the Makefile:

- Do not call `uv run scrape` directly.
- Do not call `python3 scripts/check_record_counts.py snapshot` between scrape steps to "reset" the baseline. The snapshot must be taken once, before any scrape runs.
- Do not pass `--no-verify` or `--force` to any command.

## Pipeline notes

| Stage | Command | Notes |
|---|---|---|
| Pipeline A | `make quick` | Live scrapers. Stateless. Safe to re-run. |
| Pipeline B discover | `make discover` | Playwright walks DocumentCenter tree → `documents.db`. |
| Pipeline B download | `make download` | Fetches files → `doc_cache/`. Skips already-downloaded. |
| Pipeline B analyze | `make analyze` | LLM classification. Requires vLLM. |
| Pipeline B export | `make export-docs` | Writes `doc_*.json` from DB. |

- Pipeline B stages must run **in order**. `make all` and `make docs` handle this.
- `make download --retry-errors` retries previously failed downloads — only invoke if asked.
- `scrape library` returns 0–2 events because LibCal blocks scraping; this is expected. If `library_events.json` was already 0, holding at 0 is a pass.

## Recovery (only if the caller asks)

If `make check` failed and the caller asks you to recover:

```bash
git status data/                        # see what changed
git restore data/<file-that-shrunk>.json
python3 scripts/check_record_counts.py check  # verify recovery
```

Do not run scrapers again after recovery without explicit instruction.
