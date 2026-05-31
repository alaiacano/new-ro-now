---
name: weekly-update
description: Run the New Rochelle civic data scraper, build the web frontend, commit and push data changes to GitHub. Use when performing scheduled weekly updates or on-demand data refreshes for the new-ro-monitor project.
---

# Weekly Update

## Overview

Automates the full update cycle for the New Rochelle civic data monitor:
1. Scrape live data (Pipeline A) and/or DocumentCenter documents (Pipeline B)
2. Build the React frontend
3. Commit and push data changes to GitHub

Run from the repository root (`/Users/alaiacano/dev/github/alaiacano/new-ro-monitor`).

## Prerequisites

One-time setup:
```bash
cd scraper && uv sync
playwright install chromium   # headless browser for DocumentCenter discovery
```

## Step 1 — Scrape Data

### Pipeline A: Quick Refresh (safe, fast, daily)

Always re-fetches all live sources. No state, no GPU needed.

```bash
uv run --project scraper scrape all
```

Individual sources (if only one needs updating):
```bash
uv run --project scraper scrape meetings
uv run --project scraper scrape construction
uv run --project scraper scrape paving
uv run --project scraper scrape bids
uv run --project scraper scrape news
```

> **Note:** `scrape library` is often blocked by LibCal and returns 0–2 events. It requires Playwright (not implemented in cron path).

### Pipeline B: DocumentCenter Mirror (stateful, sequential, weekly)

Must run stages in order. Each stage is safe to re-run.

```bash
# Stage 1 — Discover (walk folder tree, records metadata)
uv run --project scraper scrape discover

# Stage 2 — Download (fetches files, extracts text)
uv run --project scraper scrape download --retry-errors

# Stage 3 — Analyze (LLM classification, requires GPU)
# Requires running vLLM first:
vllm serve Qwen/Qwen3.6-35B-A3B-FP8 --quantization fp8 --max-model-len 8192
# Then:
uv run --project scraper scrape analyze --api-url http://spark-2c6d.local:8000/v1 --model qwen36-35b --concurrency 2

# Stage 4 — Export (writes JSON for frontend)
uv run --project scraper scrape export-docs
```

## Step 2 — Build Frontend

```bash
cd web && npm run build
```

This generates static files into `web/dist/`, which are copied to `web/public/data/` by the build process. The web server serves the static site from `web/dist/`.

## Step 3 — Commit and Push

Only commit JSON data files — `doc_cache/`, `documents.db`, and `node_modules/` are gitignored.

```bash
cd /Users/alaiacano/dev/github/alaiacano/new-ro-monitor

# Stage data changes
git add data/*.json data/doc_*.json

# Check if there are changes
if ! git diff --cached --quiet; then
  git commit -m "chore: refresh civic data [auto]"
  git push
fi
```

> **Do NOT commit** `data/doc_cache/`, `data/documents.db`, `web/dist/`, `web/public/data/`, `web/node_modules/`, or `scraper/.venv/`.

## Verification

1. **Check for errors** — look for `Traceback` or non-zero exit codes after each step
2. **Verify output files** after scraping:
   ```bash
   ls -la data/*.json data/doc_*.json 2>/dev/null
   ```
3. **Confirm git commit** succeeded:
   ```bash
   git log --oneline -1
   ```
4. **Check meta timestamps** updated:
   ```bash
   cat data/meta.json
   ```

## Pitfalls

- **Concurrency bug**: `analyze` defaults to 8 but should be 2. Pass `--concurrency 2` explicitly — the GPU is the bottleneck.
- **Pipeline B is sequential**: do not run stages in parallel. `discover` → `download` → `analyze` → `export-docs` in order.
- **vLLM must be running** before `analyze`. Start it in a separate process and wait for it to be ready.
- **Library scraper** often blocked — don't worry if `scrape library` returns few events.
- **Nominatim rate limit**: 1 req/sec built into the geocoder. No action needed.
