"""Central config: URLs and file paths."""
from pathlib import Path

# Repo root is two levels up from this file (scraper/src/scraper/)
REPO_ROOT = Path(__file__).parent.parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

GEOCACHE_FILE = DATA_DIR / "geocache.json"
META_FILE = DATA_DIR / "meta.json"
DB_FILE = DATA_DIR / "documents.db"
DOC_CACHE_DIR = DATA_DIR / "doc_cache"
DOC_CACHE_DIR.mkdir(exist_ok=True)

# --- Permits (Municity 5 / CitySquared backend) ---
# The CitySquared portal (citysquared.com) is a Cloudflare-gated SPA, but its
# data service is a public, unauthenticated WCF/REST endpoint. The bulk
# /Application list returns every permit application citywide (~43k rows, ~52MB).
# Per-parcel endpoints (/Parcel/{id}/Application|Permit|Document) are also public,
# but the bulk dump carries no internal Parcel_ID, so syncing pulls the full list.
MUNICITY_CUSTOMER = "NewRochelleCityNY"
MUNICITY_BASE = (
    f"https://services3.municity5.com/M5Services/M5Service.svc/Customer/{MUNICITY_CUSTOMER}"
)
MUNICITY_APPLICATIONS_URL = f"{MUNICITY_BASE}/Application"
# A real browser User-Agent + citysquared Referer keeps the vendor service happy.
MUNICITY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://www.citysquared.com/",
}

# Local, gitignored SQLite store for permit data (source of truth for querying).
PERMITS_DB_FILE = DATA_DIR / "permits.db"
# JSON exports (both gitignored). _full includes PII (names/emails/phones).
PERMITS_EXPORT_PUBLIC = DATA_DIR / "permits_public.json"
PERMITS_EXPORT_FULL = DATA_DIR / "permits_full.json"

BASE_URL = "https://www.newrochelleny.gov"
DOCENTER_URL = f"{BASE_URL}/DocumentCenter/"

# iCal category IDs for board/government meetings
MEETING_CALENDARS = {
    "Planning Board": 57,
    "Zoning Board": 55,
    "City Clerk": 33,
    "Parks and Recreation": 34,
    "Public Works": 19,
    "Senior Center": 32,
    "Youth Bureau": 27,
    "Historical & Landmark Review Board": 58,
    "Municipal Arts Commission": 35,
    "IDA": 60,
    "Development": 62,
    "Civil Service": 63,
    "GreeNR": 105,
    "CPPB": 108,
    "Housing": 90,
    "Finance": 54,
}

ICAL_URL_TEMPLATE = (
    "https://www.newrochelleny.gov/common/modules/iCalendar/iCalendar.aspx"
    "?catID={cat_id}&feed=calendar"
)

ROADWAY_ALERTS_URL = "https://www.newrochelleny.gov/762/Roadway-Alerts"
FLOOD_PROJECTS_URL = "https://www.newrochelleny.gov/1831/Flood-Mitigation-Projects"
BIDS_URL = "https://www.newrochelleny.gov/bids.aspx"
NEWS_RSS_URL = "https://www.newrochelleny.gov/RSSFeed.aspx?ModID=1&CID=All-0"
PUBLIC_HEARINGS_URL = "https://www.newrochelleny.gov/1146/Public-Hearings-Notices"

LIBRARY_EVENTS_URL = "https://newrochelle.librarycalendar.com/events/list"

# Nominatim geocoding
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_DELAY_S = 1.1  # rate limit: 1 request/sec
GEOCODE_CITY_SUFFIX = ", New Rochelle, NY"
