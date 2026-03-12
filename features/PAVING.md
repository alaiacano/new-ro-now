# Feature: Paving Schedule

## What this is

The city publishes a yearly paving list as PDF files on the Paving page. The list is updated annually (released "in late spring") and covers both a citywide list and a separate downtown list. This feature would scrape those PDFs, parse the structured table inside them, geocode each street segment, and surface them on the map and in a new Paving tab.

---

## Source page

**URL:** `https://www.newrochelleny.gov/948/Paving`

**PDF links (2025 — update annually):**
- Citywide: `https://www.newrochelleny.gov/DocumentCenter/View/20854/2025-Paving-List---Citywide`
- Downtown: `https://www.newrochelleny.gov/DocumentCenter/View/20855/2025-Downtown-Paving-List`

These links change each year. The scraper will need to re-fetch the Paving page and extract the current PDF URLs dynamically from the `DocumentCenter/View/` links rather than hardcoding them.

**iCal feed (catID=107):** Exists but is currently empty — not useful.

---

## PDF structure

Both PDFs are **text-based** (not scanned images) — `pypdf` can extract text directly with no OCR needed.

Each PDF is **1 page** with a table in this format:

```
# Street              To                      From
1 Allard Ave          Main St                 John St
2 Baraud Rd           N Severn St             Wilmot Rd
3 Barnard Rd*         Beechmont Dr            Rockledge Pl
...
```

Columns:
- `#` — row number (integer)
- `Street` — the street being paved (may have `*` suffix indicating a note)
- `To` — one end of the segment
- `From` — the other end of the segment (or `Dead End`, `Cul-De-Sac`, `End to End`)

The `*` suffix on street names appears in the citywide list and seems to indicate a qualifier (e.g. partial block). Strip it for geocoding but preserve it in the display title.

**Citywide sample (31+ entries, 1 page):**
```
1  Allard Ave          Main St          John St
2  Baraud Rd           N Severn St      Wilmot Rd
22 Lafayette Ave       5th St           2nd St
30 Rolling Way         Broadfield Rd    Belleau Ave
```

**Downtown sample (11 entries, 1 page):**
```
1  Huguenot St         Pintard Ave      Centre Ave
2  Huguenot St         Centre Ave       Division St (South)
9  LeCount Pl          Huguenot St      Anderson Plaza
10 North Ave           Huguenot St      Anderson Plaza
```

Note the downtown list breaks Huguenot St into multiple segments between intersections.

---

## Parsing approach

`pypdf.PdfReader` is the right tool. Confirmed working:

```python
import pypdf, httpx, tempfile, os

resp = httpx.get(pdf_url, follow_redirects=True, headers={"User-Agent": "new-ro-monitor/1.0"})
with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
    f.write(resp.content)
    fname = f.name

reader = pypdf.PdfReader(fname)
text = reader.pages[0].extract_text()
os.unlink(fname)
```

`pypdf` is not currently in `scraper/pyproject.toml` — add it to `dependencies`.

### Parsing the table text

`extract_text()` returns lines like:
```
1 Allard Ave Main St John St \n2 Baraud Rd N Severn St Wilmot Rd \n...
```

The tricky part is that the three columns are separated by spaces, and street names can be multi-word. The reliable parse strategy is:

1. Split on newlines.
2. Use a regex to match a leading row number: `^(\d+)\s+(.+)`.
3. For the remainder of the line, the `Street` field ends where `To` begins. Since `To` and `From` are always street names (or "Dead End" / "Cul-De-Sac"), a heuristic split works: find the first occurrence of a known cross street suffix or known terminal phrase after the first street name.
4. Alternative (simpler): since the text is extracted in column order, `pypdf` may preserve column boundaries with extra whitespace — split on 2+ consecutive spaces.

Recommended regex for a cleaned line:
```python
import re
# Match: number, then 2+-space-delimited columns
pattern = re.compile(r'^(\d+)\s{1,4}(.+?)\s{2,}(.+?)\s{2,}(.+?)\s*$')
```

If column spacing is inconsistent, fall back to extracting just the street name (column 2) and skip `To`/`From` — enough for geocoding a point on the street.

---

## Geocoding

Use the existing `scraper/src/scraper/geocoder.py` infrastructure (Nominatim + `geocache.json`).

For a **segment** (street + cross streets), there are two options:

1. **Geocode the street name only** — `"Allard Ave, New Rochelle, NY"` → places a pin somewhere on the street. Simple, good enough for map display.
2. **Geocode the midpoint of the segment** — geocode both cross streets on that street and average the coordinates. More accurate but requires two geocoding calls per row and more complex logic.

**Recommendation:** Start with option 1. The map will show a pin per street being paved, which is the minimum useful display. Option 2 can be added later.

---

## Data schema

Output file: `data/paving.json`

```json
[
  {
    "row": 1,
    "street": "Allard Ave",
    "to": "Main St",
    "from": "John St",
    "list": "citywide",
    "year": 2025,
    "coords": { "lat": 40.9234, "lng": -73.7901 },
    "note": null
  },
  {
    "row": 3,
    "street": "Barnard Rd",
    "to": "Beechmont Dr",
    "from": "Rockledge Pl",
    "list": "citywide",
    "year": 2025,
    "coords": null,
    "note": "*"
  }
]
```

Fields:
- `row` — original row number from PDF
- `street` — street name, `*` stripped
- `to` / `from` — segment endpoints as printed
- `list` — `"citywide"` or `"downtown"`
- `year` — year of the list (parsed from PDF title or page heading)
- `coords` — geocoded point on the street, or `null`
- `note` — `"*"` if the original had an asterisk, else `null`

---

## Scraper changes

### 1. Add `pypdf` to dependencies

`scraper/pyproject.toml`:
```toml
dependencies = [
    ...
    "pypdf>=4.0",
]
```

### 2. New source module: `scraper/src/scraper/sources/paving.py`

Responsibilities:
- Fetch `/948/Paving` and extract the current year's PDF URLs from `DocumentCenter/View/` links
- Download both PDFs
- Parse with `pypdf`
- Geocode street names via `geocoder.geocode_many()`
- Return list of dicts

### 3. Wire into `main.py`

Add a `cmd_paving` command and include it in `cmd_all`.

### 4. `meta.json` key: `"paving"`

---

## Frontend changes

### New tab: Paving

Add `{ id: 'paving', label: '🛣 Paving' }` to the `TABS` array in `App.jsx`.

### Map integration

Add paving streets to the existing `MapView` as a third color (e.g. green pins). Since the list can have 30+ streets, consider a toggle to show/hide the paving layer rather than showing all pins by default.

### New component: `PavingView.jsx`

A simple list grouped by `list` (citywide / downtown), showing:
- Street name
- Segment: "From [from] to [to]"
- Mapped / not mapped indicator
- Link back to the paving page

---

## Edge cases to handle

- **PDF URL changes annually** — detect new year's links by re-scraping `/948/Paving` each run; warn if no PDF link is found
- **Multi-page PDFs** — currently both are 1 page, but future years may add pages; iterate `reader.pages` not just `pages[0]`
- **`*` footnote streets** — strip asterisk before geocoding, preserve in `note` field
- **"Dead End" / "Cul-De-Sac" / "End to End"** — valid `to`/`from` values; don't try to geocode them as cross streets
- **Downtown segment duplication** — Huguenot St appears 8 times with different cross streets; all 8 rows geocode to the same street, so deduplicate coords by `street` when rendering map pins (show one pin per street, not per row)

---

## Testing

After implementing, verify:

```bash
cd scraper
uv run scrape paving
```

Expected output:
```
Fetching paving page...
  Found PDFs: citywide (2025), downtown (2025)
  Parsing citywide PDF... → 31 streets
  Parsing downtown PDF... → 6 unique streets (11 segments)
  Geocoding 37 addresses...
✓ 37 paving entries → data/paving.json
```

Check `data/paving.json` — expect ~37 entries, most with non-null `coords`.
