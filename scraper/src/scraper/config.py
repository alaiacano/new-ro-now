"""Central config: URLs and file paths."""
from pathlib import Path

# Repo root is two levels up from this file (scraper/src/scraper/)
REPO_ROOT = Path(__file__).parent.parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

GEOCACHE_FILE = DATA_DIR / "geocache.json"
META_FILE = DATA_DIR / "meta.json"

BASE_URL = "https://www.newrochelleny.gov"

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
