# Architecture

How data flows from the city website into the web app.

---

## Overview

Two independent pipelines feed the same static JSON files in `data/`, which the React frontend loads directly. No backend server at runtime.

```
City websites ──► scraper ──► data/*.json ──► React app (GitHub Pages)
                     │
                     └──► data/documents.db  (DocumentCenter only)
                     └──► data/doc_cache/    (DocumentCenter only)
```

---

## Pipeline 1: HTML/iCal scrapers (`scrape all`)

These are simple, stateless scrapers. Each run fetches live data from the city website, overwrites the relevant JSON file, and is done. **Nothing is cached** — re-running always re-fetches everything.

| Command | Source | Method | Output |
|---|---|---|---|
| `scrape meetings` | 16 city iCal feeds | HTTP GET → parse iCal | `meetings.json` |
| `scrape construction` | `/762/Roadway-Alerts`, `/1831/Flood-Mitigation-Projects` | HTTP GET → parse HTML | `construction.json` |
| `scrape paving` | `/948/Paving` → PDF links | HTTP GET → parse HTML, download PDFs, parse text | `paving.json` |
| `scrape bids` | `/bids.aspx` | HTTP GET → parse HTML table | `bids.json` |
| `scrape news` | RSS feed, `/1146/Public-Hearings-Notices` | HTTP GET → parse RSS + HTML | `news.json`, `public_hearings.json` |

**Geocoding** (Nominatim/OpenStreetMap) is used by `construction` and `paving` to turn addresses into lat/lng. Results are cached in `data/geocache.json` so addresses are only looked up once across runs.

**To refresh all HTML/iCal data:**
```bash
cd scraper
uv run scrape all
```

Then commit and push `data/*.json` to redeploy.

---

## Pipeline 2: DocumentCenter mirror

The city's DocumentCenter hosts ~2,500 documents across 70+ folders. Because the folder tree is JavaScript-rendered (Ant Design component) and the document listing API requires an authenticated browser session, this pipeline has multiple stages and uses a local SQLite database to track state.

### Storage

| Path | Contents | Git? |
|---|---|---|
| `data/documents.db` | SQLite: folder tree, document metadata, extracted text, LLM analysis results | No (gitignored) |
| `data/doc_cache/` | Downloaded files (PDF, DOCX, etc.) | No (gitignored) |
| `data/doc_*.json` | Exported results for the frontend | Yes |

### Stage 1 — Discover (`scrape discover`)

Walks the full DocumentCenter folder tree using Playwright (headless Chromium). For each folder node in the Ant Design tree, it:
1. Clicks the node to trigger the AJAX load
2. Intercepts the POST body to capture the `folderId`
3. Calls the API (`/Admin/DocumentCenter/Home/Document_AjaxBinding`) from within the browser session (to inherit auth cookies) to paginate through all documents
4. Writes folder and document metadata (title, URL, file type, size) to `documents.db`

**Idempotent:** uses `INSERT OR IGNORE` — re-running only adds new records, never duplicates. Safe to run again after new documents are published.

**Does not download files.** Discovery is just metadata.

```bash
cd scraper
uv run scrape discover
```

### Stage 2 — Download (`scrape download`)

Downloads each file discovered in Stage 1 to `data/doc_cache/{id}.ext`. For PDFs and DOCX files, also extracts text and stores it in the `doc_text` table. Uses async httpx with a concurrency limit and delay to be polite to the server.

**Cached:** skips any file that already has a `downloaded_at` timestamp in the DB. Re-running only fetches new files.

```bash
cd scraper
uv run scrape download              # all pending
uv run scrape download --limit 20   # quick test
uv run scrape download --retry-errors  # retry previously failed downloads
uv run scrape download --folder-id 22  # only a specific folder subtree
```

### Stage 3 — Analyze (`scrape analyze`)

Sends each document's extracted text to a local LLM (via OpenAI-compatible API) for classification and data extraction. Results are written to the `doc_analysis` table.

**Requires a running vLLM server** (GPU machine, separate terminal):
```bash
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ --quantization awq --tensor-parallel-size 2
```

The LLM extracts:
- `relevant` — is this civic info or a blank form/flyer? (bool)
- `ui_tab` — which section of the app: `map | meetings | bids | news | paving | none`
- `classification` — document type: `meeting_minutes | agenda | bid | permit | construction | public_hearing | ordinance | report | press_release | environmental_review | form_template | other`
- `summary` — 2–3 sentence plain-English description
- `relevant_date` — the date the document is *about* (YYYY-MM-DD)
- `project_name`, `dollar_amount`, `location` — structured fields when present
- `tags` — 3–5 keyword tags
- `confidence` — float 0–1

**Cached:** skips documents already in `doc_analysis` unless `--reanalyze` is passed.

```bash
cd scraper
uv run scrape analyze \
  --api-url http://<gpu-host>:8000/v1 \
  --model Qwen/Qwen2.5-32B-Instruct-AWQ

# options
--limit 50           # analyze only N docs (good for testing prompt quality)
--folder-id 22       # only a specific folder subtree
--reanalyze          # re-process already-analyzed docs (e.g. after prompt changes)
--concurrency 16     # parallel requests (default 8)
```

Geocoding runs inline: if the LLM extracts a `location`, Nominatim is called and `coords_lat`/`coords_lng` are stored. Geocache in `data/geocache.json` prevents redundant lookups.

### Stage 4 — Export (`scrape export-docs`)

Reads `doc_analysis` (joined with `documents` and `folders`) and writes JSON files shaped to match the existing HTML-scraped data. The frontend merges these into the same tabs without special-casing.

**Not cached:** always re-reads the full DB and overwrites output files. Fast (pure SQL → JSON, no network).

```bash
cd scraper
uv run scrape export-docs
cp ../data/doc_*.json ../web/public/data/   # if dev server is running
```

Output files:

| File | Tab | Filter |
|---|---|---|
| `doc_map.json` | Map (📄 Document layers) | `relevant=1` AND has coordinates |
| `doc_meetings.json` | Meetings | `ui_tab=meetings` |
| `doc_news.json` | News | `ui_tab=news` |
| `doc_bids.json` | Bids | `ui_tab=bids` |
| `doc_explorer.json` | (not yet a tab) | all `relevant=1` |

---

## Database schema (`data/documents.db`)

```
folders         id, parent_id, name, path, discovered_at
documents       id, folder_id, title, url, file_type, file_size_bytes,
                published_date, discovered_at, downloaded_at, local_path, download_error
doc_text        doc_id, extracted_at, method, text
doc_analysis    doc_id, analyzed_at, model, relevant, ui_tab, classification,
                summary, relevant_date, project_name, dollar_amount,
                location, coords_lat, coords_lng, tags, confidence
processing_log  id, doc_id, step, status, message, ts
```

---

## Typical refresh workflow

### Quick weekly refresh (HTML sources only)
```bash
cd scraper && uv run scrape all
# commit data/*.json (excluding doc_*.json if no new analysis)
```

### After new DocumentCenter documents are published
```bash
cd scraper
uv run scrape discover          # find new folders/docs (safe to re-run)
uv run scrape download          # fetch only new files
# start vLLM on GPU machine, then:
uv run scrape analyze --api-url http://<host>:8000/v1 --model Qwen/Qwen2.5-32B-Instruct-AWQ
uv run scrape export-docs
# commit data/doc_*.json
```

### After changing the LLM prompt (re-analyze everything)
```bash
cd scraper
# start vLLM first, then:
uv run scrape analyze --reanalyze --api-url http://<host>:8000/v1 --model Qwen/Qwen2.5-32B-Instruct-AWQ
uv run scrape export-docs
# commit data/doc_*.json
```

### Deploying to production
```bash
git add data/*.json
git commit -m "refresh data"
git push
# GitHub Actions builds and deploys automatically
```

---

## What is and isn't cached

| Operation | Cached? | Key |
|---|---|---|
| Document metadata (discover) | Yes — `INSERT OR IGNORE` | document URL |
| File downloads | Yes — skipped if `downloaded_at` set | doc id in DB |
| PDF/DOCX text extraction | Yes — stored in `doc_text`, not re-extracted | doc id in DB |
| LLM analysis | Yes — skipped if row in `doc_analysis` (unless `--reanalyze`) | doc id in DB |
| Geocoding | Yes — `data/geocache.json` | address string |
| HTML scraping (construction, bids, news, etc.) | No — always re-fetched | — |
| iCal feeds (meetings) | No — always re-fetched | — |
| Paving PDF download | No — re-downloaded each run | — |
