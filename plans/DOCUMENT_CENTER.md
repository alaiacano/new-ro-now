# Document Center: Mirror, Classify & UI

## Goal

Build a local mirror of **every document** in
`https://www.newrochelleny.gov/DocumentCenter/` — then classify, summarize, and
surface them in a better UI. The primary objective is **get a complete local copy first**;
analysis and UI come after.

The city's document management is poorly maintained and documents disappear without
notice. A local mirror is valuable on its own.

---

## Research Findings

### What the site does

The DocumentCenter uses CivicEngage (CivicPlus). Folder listings are **JavaScript-rendered**
— plain HTTP GETs return an empty shell. Individual documents work fine via plain HTTP:

- `GET /DocumentCenter/View/{docId}` → redirects to the actual file (PDF, DOCX, image, etc.)
- Folder hierarchy exposed via `window.folderId` / `window.parentId` JS globals, but the
  tree data itself loads dynamically — Playwright required to walk it.

### Scraping approach

| Task | Tool | Reason |
|------|------|--------|
| Discover folders & doc IDs | **Playwright** | JS-rendered, no static HTML |
| Download files | **httpx** | Plain redirect, works without JS |
| Extract PDF text | **pypdf** | Already in dep tree |
| Classify & summarize | **Claude Sonnet API** | Handles arbitrary doc content |

---

## Architecture

```
DocumentCenter
      │
  [Playwright]  ── scrape discover
      │ discovers folder tree + doc IDs
      ▼
  SQLite DB  (data/documents.db)
      │
  [httpx]  ── scrape download
      │ downloads every file to data/doc_cache/{id}.{ext}
      ▼
  data/doc_cache/          ← THE LOCAL MIRROR (primary goal)
      ├── 21498.png
      ├── 22014.pdf
      ├── 22015.docx
      └── ...
      │
  [pypdf]  ── part of scrape download
      │ extracts text from PDFs → stored in doc_text table
      ▼
  [Claude Sonnet]  ── scrape analyze (optional, run later)
      │ classify, summarize, extract structured fields
      ▼
  [scrape export-docs]
      │ generates JSON for web frontend
      ▼
  web/public/data/
      ├── documents.json
      ├── doc_map.json
      └── doc_calendar.json
```

---

## SQLite Schema  (`data/documents.db`)

```sql
CREATE TABLE folders (
    id            INTEGER PRIMARY KEY,   -- CivicEngage folder ID
    parent_id     INTEGER,
    name          TEXT NOT NULL,
    path          TEXT,                  -- "Public Works / Reports / 2024"
    discovered_at TEXT
);

CREATE TABLE documents (
    id              INTEGER PRIMARY KEY,  -- CivicEngage doc ID
    folder_id       INTEGER REFERENCES folders(id),
    title           TEXT,
    url             TEXT,                 -- canonical /DocumentCenter/View/{id}
    file_type       TEXT,                 -- pdf, docx, xlsx, png, …
    file_size_bytes INTEGER,
    published_date  TEXT,                 -- from CivicEngage metadata if available
    discovered_at   TEXT,
    downloaded_at   TEXT,                 -- NULL = not yet downloaded
    local_path      TEXT,                 -- data/doc_cache/{id}.{ext}
    download_error  TEXT                  -- error message if download failed
);

CREATE TABLE doc_text (
    doc_id      INTEGER PRIMARY KEY REFERENCES documents(id),
    extracted_at TEXT,
    method      TEXT,    -- 'pypdf' | 'docx' | 'none'
    text        TEXT     -- full extracted text (can be large)
);

CREATE TABLE doc_analysis (
    doc_id          INTEGER PRIMARY KEY REFERENCES documents(id),
    analyzed_at     TEXT,
    model           TEXT,               -- e.g. claude-sonnet-4-6
    classification  TEXT,               -- meeting_minutes | budget | permit | paving |
                                        --   construction | public_hearing | ordinance |
                                        --   report | bid | agenda | map | other
    summary         TEXT,
    relevant_date   TEXT,               -- date the doc is *about* (not published date)
    project_name    TEXT,
    dollar_amount   TEXT,
    address         TEXT,               -- raw extracted address string
    coords_lat      REAL,
    coords_lng      REAL,
    tags            TEXT,               -- JSON array
    confidence      REAL
);

CREATE TABLE processing_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id  INTEGER,
    step    TEXT,    -- 'download' | 'extract' | 'analyze' | 'export'
    status  TEXT,    -- 'ok' | 'error' | 'skipped'
    message TEXT,
    ts      TEXT
);
```

---

## Phase 1 — Discovery  (`scrape discover`)

**Goal:** Populate `folders` and `documents` tables. No files downloaded yet.

1. Launch Playwright (headless Chromium).
2. Navigate to `https://www.newrochelleny.gov/DocumentCenter/`.
3. Walk the full folder tree recursively:
   - For each folder node: record `folder_id`, `name`, `parent_id`, build path string.
   - For each document node: record `doc_id`, `title`, `published_date`, `file_type`, `folder_id`.
4. Write to SQLite with `INSERT OR IGNORE` — safe to re-run, only adds new records.
5. Print a summary: N folders, M documents discovered.

**Idempotent:** Yes — re-running adds new docs/folders without touching existing rows.

**Cadence:** Run weekly or on-demand to catch new documents.

**Unknown:** Total document count. Could be 2k–20k. Discover first, then decide on
batch sizing for download.

---

## Phase 2 — Download  (`scrape download [--limit N] [--folder-id F]`)

**Goal:** Build a complete local mirror in `data/doc_cache/`.

For each document in `documents` where `downloaded_at IS NULL` (and no prior error, or `--retry-errors`):

1. `GET /DocumentCenter/View/{id}` via httpx (follows redirect to actual file URL).
2. Save to `data/doc_cache/{id}.{ext}` — derive extension from `Content-Type` or redirect URL.
3. Record `downloaded_at`, `file_size_bytes`, `local_path` in `documents`.
4. For PDFs: immediately run pypdf text extraction → write to `doc_text`.
5. For DOCX: extract text with `python-docx` → write to `doc_text`.
6. For everything else (images, XLS, etc.): save file, skip text extraction, note method='none'.
7. On any error: record `download_error`, log to `processing_log`, continue.

**Rate limiting:** 2 req/sec, randomized jitter. Polite but thorough.

**Idempotent:** Skip if `downloaded_at IS NOT NULL`. Re-run picks up where it left off.

**Flags:**
- `--limit N` — download at most N files (useful for testing)
- `--folder-id F` — only download docs in a specific folder subtree
- `--retry-errors` — retry previously failed downloads

**Storage estimate:** If average PDF is 500 KB and there are 5000 docs, that's ~2.5 GB.
Images and DOCX will vary. Plan for 5–10 GB total.

---

## Phase 3 — Analyze  (`scrape analyze [--limit N] [--reanalyze] [--api-url URL] [--model NAME]`)

**Goal:** Use a **local LLM** to classify and extract structured data from each document.
Claude API is not cost-effective at 2,500+ docs. Use local model on A6000 GPUs instead.

**Hardware:** 2× A6000 (96GB VRAM total). Run **vLLM** for OpenAI-compatible serving.

**Recommended models:**

| Model | VRAM (4-bit) | Notes |
|-------|-------------|-------|
| Qwen2.5-32B-Instruct | ~20GB | Best structured JSON output for the size |
| Qwen2.5-72B-Instruct | ~45GB | Highest quality, fits one A6000 at 4-bit |
| Llama-3.1-70B-Instruct | ~40GB | Strong alternative |

**Start vLLM (example):**
```bash
vllm serve Qwen/Qwen2.5-32B-Instruct --quantization awq --max-model-len 8192
```

**Scraper uses `openai` Python client** pointed at local server — no Anthropic API needed:
```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8000/v1", api_key="local")
```

For each document with extracted text where `doc_analysis.doc_id IS NULL`:

1. Build prompt with title, folder path, and first ~3000 tokens of extracted text.
2. Call local model requesting JSON:

```
Classify and summarize this New Rochelle city government document.

Title: {title}
Folder: {folder_path}
Text (truncated):
{text}

Respond with JSON only:
{
  "classification": "meeting_minutes|budget|permit|paving|construction|public_hearing|ordinance|report|bid|agenda|map|other",
  "summary": "2-3 sentence plain-English summary",
  "relevant_date": "YYYY-MM-DD or YYYY or null",
  "project_name": "specific project name or null",
  "dollar_amount": "$X.XM or null",
  "address": "street address or intersection in New Rochelle or null",
  "tags": ["keyword1", "keyword2"],
  "confidence": 0.0
}
```

3. Geocode `address` if present using existing geocoder.
4. Write to `doc_analysis`.

**CLI flags:**
- `--api-url` — default `http://localhost:8000/v1`
- `--model` — model name as served by vLLM
- `--limit N` — process N docs (pilot before full run)
- `--concurrency N` — parallel requests (default 8; local GPU handles more than API rate limits)
- `--reanalyze` — reprocess already-analyzed docs

**New dependency:** `openai>=1.0` (not `anthropic`)

---

## Phase 4 — Export  (`scrape export-docs`)

Queries SQLite, writes JSON for the web frontend:

- **`documents.json`** — full index: id, title, folder_path, classification, summary, relevant_date, tags, url
- **`doc_map.json`** — geo-tagged docs only (coords_lat NOT NULL), with coords field added
- **`doc_calendar.json`** — date-bearing docs only (relevant_date NOT NULL), sorted by date

Always safe to re-run — just regenerates from DB.

---

## Web UI — Enhancements (post-analysis)

**No document browser.** The DocumentCenter already has one. The goal is to extract structured data from PDFs and route it into the existing tabs.

### Export strategy by classification

Claude's output feeds into the *existing* data pipeline by classification:

| classification | feeds into |
|---|---|
| `meeting_minutes`, `agenda` | Calendar tab (as past/future events with link to PDF) |
| `public_hearing` | `public_hearings.json` → News tab |
| `bid` | `bids.json` → Bids tab |
| `construction`, `permit` + has address | `construction.json` → Map tab (new pins) |
| `budget`, `report`, `ordinance` | `doc_calendar.json` → Calendar tab |
| anything with `relevant_date` + `address` | Map tab + Calendar tab |

### Map (enhanced)
- Docs with geocoded addresses appear as a new layer.
- Popup: title, 1-sentence summary, classification, link to original PDF.

### Calendar tab (new)
- Month grid combining `meetings.json` (upcoming) + docs with `relevant_date` (past minutes, budgets, hearings).
- Color-coded by type.

---

## New Dependencies

**Scraper** (add to `pyproject.toml`):
```toml
"playwright>=1.40",     # discovery
"python-docx>=1.1",    # DOCX text extraction
"anthropic>=0.25",     # Claude Sonnet analysis
```
After `uv sync`: `playwright install chromium`

**Web:** No new deps for browser/map. Calendar may add `react-big-calendar` when built.

---

## Implementation Order

1. ✅ SQLite schema + `data/documents.db` init
2. ✅ `scrape discover` — 2,493 docs across 73 folders
3. ✅ `scrape download` — files in `data/doc_cache/`, text in `doc_text` table
4. `scrape analyze` — Claude pilot (50 docs from Finance/Development/Public Works), then full run
5. `scrape export-docs` — merge analysis results into existing JSON files by classification
6. Web: Calendar tab — month grid from meetings + doc dates
7. Web: Map enhancement — new pins from geocoded doc addresses

---

## Idempotency Summary

| Phase | Mechanism |
|-------|-----------|
| Discover | `INSERT OR IGNORE` on id |
| Download | Skip if `downloaded_at IS NOT NULL` |
| Extract text | Runs inline during download; skip if row in `doc_text` |
| Analyze | Skip if row in `doc_analysis` (unless `--reanalyze`) |
| Export | Always regenerates from DB — safe to re-run |

---

## Open Questions / Decisions Needed

1. **Total doc count** — unknown until discovery runs. Determines storage planning and
   whether to batch downloads over multiple sessions.
2. **Where to store `documents.db`** — gitignore it (too large for git), keep local only.
   Committed JSON exports (`documents.json` etc.) are the git-tracked artifact.
3. **`data/doc_cache/` in git?** — No. Gitignore it. It's a local mirror, not part of
   the web build. The web frontend links to the original city URLs, not local files.
4. **Non-extractable files** (scanned PDFs, images): Claude can still classify by title
   and folder. May want OCR (Tesseract) later for scanned docs.
5. **Claude API key**: `ANTHROPIC_API_KEY` env var, added to `.env` (gitignored).
