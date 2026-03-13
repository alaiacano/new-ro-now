# New Rochelle Now

A static web app that surfaces New Rochelle, NY civic data — construction projects on a map, upcoming board meetings, city bids, public hearing notices, and paving schedules — in a more consumable format than the city website.

Hosted on GitHub Pages. All data is pre-fetched and stored as JSON files in `data/`. No backend required.

---

## Refreshing data

Data is scraped from the city website and stored as JSON in `data/`. Run this whenever you want fresh data, then commit and push the updated JSON files to redeploy.

```bash
cd scraper
uv run scrape all
```

Partial refreshes:

```bash
uv run scrape meetings      # board/planning meeting schedules (iCal feeds)
uv run scrape construction  # roadway alerts + flood mitigation projects
uv run scrape paving        # annual paving schedule (downloads city PDFs)
uv run scrape bids          # open city bids/contracts
uv run scrape news          # press releases + public hearing notices
```

**First run** installs dependencies automatically via `uv`. Geocoding results are cached in `data/geocache.json` so addresses are only looked up once.

---

## DocumentCenter mirror

The city's [DocumentCenter](https://www.newrochelleny.gov/DocumentCenter/) hosts thousands of documents across 70+ folders. A separate two-step pipeline builds a local mirror.

### First-time setup

```bash
cd scraper
uv sync
playwright install chromium   # one-time: installs headless browser
```

### Step 1 — Discover

Walks the full folder tree using Playwright and records every document's metadata in `data/documents.db`. Safe to re-run — only adds new records.

```bash
uv run scrape discover
```

### Step 2 — Download

Downloads every discovered file to `data/doc_cache/` and extracts text from PDFs and DOCX files. Skips files already downloaded. Run with `--limit` for a quick test first.

```bash
uv run scrape download --limit 20   # test with 20 files
uv run scrape download               # full mirror (~2,500 files)
```

Additional flags:

```bash
uv run scrape download --folder-id 22    # only download a specific folder subtree
uv run scrape download --retry-errors    # retry previously failed downloads
```

**Storage:** `data/doc_cache/` and `data/documents.db` are gitignored — they live locally only.

### Step 3 — Analyze

Classifies each document and extracts structured data (dates, addresses, project names, dollar amounts) using a local LLM. Results feed into the existing UI tabs.

**Start the LLM server first** (requires vLLM and GPU):

```bash
vllm serve Qwen/Qwen2.5-32b-Instruct-AWQ --quantization awq --tensor-parallel-size 2
```

Then run analysis (in a separate terminal, from `scraper/`):

```bash
uv run scrape analyze --api-url http://<host>:8000/v1 --model Qwen/Qwen2.5-32b-Instruct-AWQ
```

Pilot with a small batch first to validate quality:

```bash
uv run scrape analyze --limit 50 --folder-id 22 --api-url http://192.168.86.27:8000/v1 --model Qwen/Qwen2.5-32b-Instruct-AWQ
```

Additional flags:

```bash
--concurrency 16    # parallel requests (default 8; increase for faster throughput)
--reanalyze         # re-process already-analyzed docs
--folder-id 18      # only analyze a specific folder subtree
```

---

## Running the web UI locally

```bash
cd web
npm install       # first time only
npm run dev
```

Then open http://localhost:5173.

To preview the production build:

```bash
npm run build
npm run preview
```

---

## Deploying to GitHub Pages

Push to `main`. The GitHub Actions workflow in `.github/workflows/deploy.yml` builds the app and deploys it automatically.

**One-time setup:** In your GitHub repo, go to Settings → Pages → Source → set to **GitHub Actions**.

To update the live site with fresh data: run `uv run scrape all`, commit the changed `data/*.json` files, and push.

---

## Data sources

| Source | Method | Command |
|--------|--------|---------|
| [Roadway Alerts](https://www.newrochelleny.gov/762/Roadway-Alerts) | HTML scrape | `scrape construction` |
| [Flood Mitigation Projects](https://www.newrochelleny.gov/1831/Flood-Mitigation-Projects) | HTML scrape | `scrape construction` |
| City iCal feeds (Planning Board, Zoning Board, City Clerk, ~13 others) | iCal | `scrape meetings` |
| [Paving schedule PDFs](https://www.newrochelleny.gov/948/Paving) | PDF parse | `scrape paving` |
| [City bids](https://www.newrochelleny.gov/bids.aspx) | HTML scrape | `scrape bids` |
| [City RSS feed](https://www.newrochelleny.gov/RSSFeed.aspx?ModID=1&CID=All-0) | RSS | `scrape news` |
| [Public Hearing Notices](https://www.newrochelleny.gov/1146/Public-Hearings-Notices) | HTML scrape | `scrape news` |
| [DocumentCenter](https://www.newrochelleny.gov/DocumentCenter/) (~2,500 docs, 70+ folders) | Playwright + API | `scrape discover` + `scrape download` |

Construction project addresses are geocoded via [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap, free, no API key).

### Known gaps

- **Library events** — the library calendar ([LibCal](https://newrochelle.librarycalendar.com)) blocks server-side requests. Requires Playwright to scrape.
- **Parks & Rec registration** — no structured data on the city site; registration is handled by phone/email.
