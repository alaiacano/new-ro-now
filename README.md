# New Rochelle Now

A static web app that surfaces New Rochelle, NY civic data — construction projects on a map, upcoming board meetings, city bids, and public hearing notices — in a more consumable format than the city website.

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
uv run scrape bids          # open city bids/contracts
uv run scrape news          # press releases + public hearing notices
```

**First run** installs dependencies automatically via `uv`. Geocoding results are cached in `data/geocache.json` so addresses are only looked up once.

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

| Tab | Source | Method |
|-----|--------|--------|
| Map / Projects | [Roadway Alerts](https://www.newrochelleny.gov/762/Roadway-Alerts) + individual project pages | HTML scrape |
| Map / Projects | [Flood Mitigation Projects](https://www.newrochelleny.gov/1831/Flood-Mitigation-Projects) | HTML scrape |
| Meetings | City iCal feeds (Planning Board, Zoning Board, City Clerk, and ~13 others) | iCal |
| Bids | [City bids page](https://www.newrochelleny.gov/bids.aspx) | HTML scrape |
| News | [City RSS feed](https://www.newrochelleny.gov/RSSFeed.aspx?ModID=1&CID=All-0) | RSS |
| News | [Public Hearing Notices](https://www.newrochelleny.gov/1146/Public-Hearings-Notices) | HTML scrape |

Construction project addresses are geocoded via [Nominatim](https://nominatim.openstreetmap.org/) (OpenStreetMap, free, no API key).

### Known gaps

- **Library events** — the library calendar ([LibCal](https://newrochelle.librarycalendar.com)) blocks server-side requests. Would require a headless browser (Playwright) to scrape.
- **Parks & Rec registration** — no structured data on the city site; registration is handled by phone/email.
- **Paving schedule** — only available as a PDF download.
