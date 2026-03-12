"""
Scrape library events from newrochelle.librarycalendar.com (LibCal by Springshare).
Fetches the paginated list view and parses event cards.
"""
import re
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from rich.console import Console

from ..config import LIBRARY_EVENTS_URL

console = Console()

BASE_LIB_URL = "https://newrochelle.librarycalendar.com"
MAX_PAGES = 10  # cap to avoid scraping 45 pages every run; increase if needed


def _parse_event_card(card: BeautifulSoup) -> dict | None:
    """Parse a single event card from the list view."""
    try:
        # Title and URL
        title_tag = card.find("h2") or card.find("h3")
        if not title_tag:
            return None
        link = title_tag.find("a")
        title = title_tag.get_text(strip=True)
        event_url = (BASE_LIB_URL + link["href"]) if link and link.get("href", "").startswith("/") else (link["href"] if link else None)

        # Date / time - LibCal uses <span class="date-display-single"> or similar
        date_text = None
        for selector in ["span.date-display-single", "div.date-display-single",
                         "p.program-date", "div.program-date", "time"]:
            el = card.select_one(selector)
            if el:
                date_text = el.get_text(strip=True)
                break

        if not date_text:
            # Try any element with "date" in class
            for el in card.find_all(class_=re.compile("date", re.I)):
                t = el.get_text(strip=True)
                if t:
                    date_text = t
                    break

        # Branch / location
        location = None
        for selector in ["div.branch", "span.branch", "p.branch",
                         "div.location", "span.location"]:
            el = card.select_one(selector)
            if el:
                location = el.get_text(strip=True)
                break

        # Age group / audience
        audience = None
        for selector in ["div.audience", "span.audience", "div.age-group"]:
            el = card.select_one(selector)
            if el:
                audience = el.get_text(strip=True)
                break

        # Description / summary
        description = None
        for selector in ["div.description", "p.description", "div.summary",
                         "div.field-items", "div.views-field-body"]:
            el = card.select_one(selector)
            if el:
                description = el.get_text(strip=True)[:400]
                break

        # Categories / tags
        categories = []
        for el in card.find_all(class_=re.compile("categor|tag|type", re.I)):
            t = el.get_text(strip=True)
            if t and t not in categories:
                categories.append(t)

        return {
            "title": title,
            "url": event_url,
            "date_text": date_text,
            "location": location,
            "audience": audience,
            "description": description,
            "categories": categories[:5],
        }
    except Exception as e:
        console.print(f"    [yellow]Failed to parse card: {e}[/yellow]")
        return None


def _scrape_page(page_url: str) -> tuple[list[dict], str | None]:
    """
    Scrape one page of the events list.
    Returns (events, next_page_url).
    """
    try:
        resp = httpx.get(page_url, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
    except Exception as e:
        console.print(f"  [red]Error fetching {page_url}: {e}[/red]")
        return [], None

    soup = BeautifulSoup(resp.text, "html.parser")

    # Find event cards - LibCal uses various class patterns
    cards = (soup.select("div.views-row")
             or soup.select("li.views-row")
             or soup.select("div.program-item")
             or soup.select("article")
             or soup.select("div.event-item"))

    events = []
    for card in cards:
        ev = _parse_event_card(card)
        if ev:
            events.append(ev)

    # Find next page link
    next_url = None
    next_link = soup.select_one("li.pager-next a") or soup.select_one("a[rel='next']")
    if next_link and next_link.get("href"):
        href = next_link["href"]
        next_url = (BASE_LIB_URL + href) if href.startswith("/") else href

    return events, next_url


def scrape() -> list[dict]:
    """
    Attempts to scrape library events from LibCal (newrochelle.librarycalendar.com).

    NOTE: The LibCal site (hosted on Pantheon) returns 403 for all server-side
    requests. Scraping requires a headless browser (e.g. Playwright). This
    function returns an empty list until that is implemented.

    TODO: Add Playwright-based scraping for library events.
    See: https://newrochelle.librarycalendar.com/events/month
    """
    console.print("  [yellow]Library events scraping requires a headless browser (LibCal blocks server-side requests).[/yellow]")
    console.print("  [yellow]Skipping — returning empty list. Add Playwright support to enable this.[/yellow]")
    return []
