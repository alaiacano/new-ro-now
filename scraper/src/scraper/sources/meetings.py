"""
Scrape board/government meeting schedules via iCal feeds.
Sources: Planning Board, Zoning Board, and other city calendars.
"""
from datetime import datetime, timezone, timedelta

import httpx
from icalendar import Calendar
from rich.console import Console

from ..config import ICAL_URL_TEMPLATE, MEETING_CALENDARS

console = Console()

LOOKAHEAD_DAYS = 180  # fetch events up to 6 months out


def _parse_ical(raw: bytes, calendar_name: str) -> list[dict]:
    events = []
    try:
        cal = Calendar.from_ical(raw)
    except Exception as e:
        console.print(f"[yellow]Failed to parse iCal for {calendar_name}: {e}[/yellow]")
        return events

    now = datetime.now(tz=timezone.utc)
    cutoff = now + timedelta(days=LOOKAHEAD_DAYS)

    for component in cal.walk():
        if component.name != "VEVENT":
            continue

        dtstart = component.get("DTSTART")
        dtend = component.get("DTEND")
        if not dtstart:
            continue

        start = dtstart.dt
        # Normalize to datetime with timezone
        if not hasattr(start, "hour"):
            # all-day date — convert to midnight UTC
            start = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)

        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)

        # Skip past events and events too far out
        if start < now or start > cutoff:
            continue

        end = None
        if dtend:
            end = dtend.dt
            if not hasattr(end, "hour"):
                end = datetime(end.year, end.month, end.day, tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)

        summary = str(component.get("SUMMARY", "")).strip()
        location = str(component.get("LOCATION", "")).strip()
        url = str(component.get("URL", "")).strip()
        description = str(component.get("DESCRIPTION", "")).strip()

        events.append({
            "id": str(component.get("UID", f"{calendar_name}-{start.isoformat()}")),
            "calendar": calendar_name,
            "title": summary or calendar_name,
            "start": start.isoformat(),
            "end": end.isoformat() if end else None,
            "location": location or None,
            "url": url or None,
            "description": description or None,
        })

    return events


def scrape() -> list[dict]:
    all_events: list[dict] = []

    for name, cat_id in MEETING_CALENDARS.items():
        url = ICAL_URL_TEMPLATE.format(cat_id=cat_id)
        console.print(f"  Fetching [cyan]{name}[/cyan] (catID={cat_id})...")
        try:
            resp = httpx.get(url, timeout=15, follow_redirects=True)
            resp.raise_for_status()
            events = _parse_ical(resp.content, name)
            console.print(f"    → {len(events)} upcoming events")
            all_events.extend(events)
        except Exception as e:
            console.print(f"  [red]Error fetching {name}: {e}[/red]")

    # Sort by start time
    all_events.sort(key=lambda e: e["start"])
    return all_events
