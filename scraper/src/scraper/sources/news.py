"""
Scrape city news/press releases via RSS feed.
Also scrapes Public Hearing Notices from /1146.
"""
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import httpx
from bs4 import BeautifulSoup
from rich.console import Console

from ..config import BASE_URL, NEWS_RSS_URL, PUBLIC_HEARINGS_URL

console = Console()

MAX_NEWS_ITEMS = 30


def _scrape_rss() -> list[dict]:
    console.print(f"  Fetching news RSS...")
    try:
        resp = httpx.get(NEWS_RSS_URL, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
    except Exception as e:
        console.print(f"  [red]Error: {e}[/red]")
        return []

    items = []
    try:
        root = ET.fromstring(resp.content)
        ns = {"dc": "http://purl.org/dc/elements/1.1/"}
        for item in root.iter("item"):
            title = item.findtext("title", "").strip()
            link = item.findtext("link", "").strip()
            description = item.findtext("description", "").strip()
            pub_date_raw = item.findtext("pubDate", "").strip()
            category = item.findtext("category", "").strip()

            pub_date = None
            if pub_date_raw:
                try:
                    pub_date = parsedate_to_datetime(pub_date_raw).isoformat()
                except Exception:
                    pub_date = pub_date_raw

            # Strip HTML from description
            if description:
                desc_soup = BeautifulSoup(description, "html.parser")
                description = desc_soup.get_text(strip=True)[:500]

            items.append({
                "title": title,
                "url": link,
                "description": description,
                "published": pub_date,
                "category": category,
                "source": "news_rss",
            })
    except ET.ParseError as e:
        console.print(f"  [red]RSS parse error: {e}[/red]")

    return items[:MAX_NEWS_ITEMS]


def _scrape_public_hearings() -> list[dict]:
    console.print(f"  Fetching public hearings...")
    try:
        resp = httpx.get(PUBLIC_HEARINGS_URL, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
    except Exception as e:
        console.print(f"  [red]Error: {e}[/red]")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")
    # Search the whole page — Archive.aspx links can be in various containers
    # depending on whether the URL redirected to the archive listing.
    main = soup

    hearings = []
    seen_hrefs: set[str] = set()
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=365)

    # Each entry is a link to a PDF/doc with a title like:
    # "Public Hearing Notice Re: Special Permit ... - Feb. 10, 2026"
    date_pattern = re.compile(
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+\d{1,2},?\s+\d{4}",
        re.IGNORECASE,
    )

    for a in main.find_all("a", href=True):
        title = a.get_text(strip=True)
        href = a["href"]
        # Public hearing entries link to Archive.aspx?ADID=NNN
        if not title or "Archive.aspx?ADID=" not in href:
            continue
        if href in seen_hrefs:
            continue
        seen_hrefs.add(href)
        url = (BASE_URL + "/" + href.lstrip("/")) if not href.startswith("http") else href

        # Extract date from title; skip if no date or if older than cutoff
        date_match = date_pattern.search(title)
        date_str = date_match.group(0) if date_match else None
        if not date_str:
            continue  # no date in title → skip (old archive entries)
        # Normalize: "Sept" → "Sep", strip periods and commas
        cleaned = date_str.replace(".", "").replace(",", "").replace("Sept", "Sep")
        parsed_date = None
        for fmt in ("%b %d %Y", "%B %d %Y"):
            try:
                parsed_date = datetime.strptime(cleaned, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                pass
        if parsed_date is None or parsed_date < cutoff:
            continue

        hearings.append({
            "title": title,
            "url": url,
            "date_text": date_str,
            "source": "public_hearings",
        })

    console.print(f"  → {len(hearings)} public hearing notices")
    return hearings


def scrape() -> dict:
    news = _scrape_rss()
    console.print(f"  → {len(news)} news items")
    hearings = _scrape_public_hearings()
    return {
        "news": news,
        "public_hearings": hearings,
    }
