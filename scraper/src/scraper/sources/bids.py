"""
Scrape active city bids/contracts from /bids.aspx.
The page is a sortable HTML table with columns:
  Bid Number | Title | Status | Closing Date | Description
"""
import re
from datetime import datetime

import httpx
from bs4 import BeautifulSoup
from rich.console import Console

from ..config import BASE_URL, BIDS_URL

console = Console()


def _parse_date(s: str) -> str | None:
    s = s.strip()
    for fmt in ("%m/%d/%Y %I:%M %p", "%m/%d/%Y", "%B %d, %Y"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            pass
    return s or None


def scrape() -> list[dict]:
    console.print(f"  Fetching bids from {BIDS_URL}...")
    try:
        resp = httpx.get(BIDS_URL, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
    except Exception as e:
        console.print(f"  [red]Error: {e}[/red]")
        return []

    soup = BeautifulSoup(resp.text, "html.parser")

    # CivicPlus bids page uses div.listItemsRow.bid for each bid entry.
    # Each row contains:
    #   div.bidTitle  — title text + "Bid No.XXXX" + description
    #   div.bidStatus — "Status: Open/Closed  Closes: MM/DD/YYYY HH:MM AM/PM"
    bid_rows = soup.find_all("div", class_=lambda c: c and "listItemsRow" in c and "bid" in c)
    if not bid_rows:
        console.print("  [yellow]No bid rows found (div.listItemsRow.bid)[/yellow]")
        return []

    bids = []
    for row in bid_rows:
        title_div = row.find("div", class_="bidTitle")
        status_div = row.find("div", class_="bidStatus")

        if not title_div:
            continue

        title_text = title_div.get_text(separator=" ", strip=True)

        # Extract bid number from "Bid No.5856" pattern
        bid_num_match = re.search(r"Bid\s*No\.?\s*([A-Z0-9\-]+)", title_text, re.IGNORECASE)
        bid_number = bid_num_match.group(1) if bid_num_match else ""

        # Title is before "Bid No." — also strip leading "BIDNUM - " prefix
        raw_title = re.split(r"Bid\s*No\.?", title_text)[0].strip()
        # Strip "5856 - " or "RFB-FA-2026-006 - " prefix from title if present
        title = re.sub(r"^[A-Z0-9\-]+ - ", "", raw_title).strip() or raw_title

        # Description is the remainder after bid number
        desc_parts = re.split(r"Bid\s*No\.?\s*[A-Z0-9\-]+", title_text, maxsplit=1)
        description = desc_parts[1].strip() if len(desc_parts) > 1 else ""
        # Strip trailing "[ Read on ]" noise
        description = re.sub(r"\[?\s*Read\s*[\xa0 ]*on\s*\]?", "", description).strip()

        status = ""
        closing_date = None
        if status_div:
            # Structure: two child divs — first has label spans, second has value spans
            spans = status_div.find_all("span")
            # Filter out the label spans (they contain "Status:" or "Closes:")
            value_spans = [s for s in spans if not re.search(r"Status:|Closes:", s.get_text())]
            if len(value_spans) >= 1:
                status = value_spans[0].get_text(strip=True)
            if len(value_spans) >= 2:
                closing_date = _parse_date(value_spans[1].get_text(strip=True))

        # Link — href is relative like "bids.aspx?bidID=1068"
        link = row.find("a", href=True)
        url = None
        if link:
            href = link["href"]
            if href.startswith("http"):
                url = href
            elif href.startswith("/"):
                url = BASE_URL + href
            else:
                url = BASE_URL + "/" + href

        bids.append({
            "bid_number": bid_number,
            "title": title,
            "status": status,
            "closing_date": closing_date,
            "description": description[:500],
            "url": url,
        })

    active = [b for b in bids if b.get("status", "").lower() == "open"]
    console.print(f"  → {len(bids)} total bids, {len(active)} open")
    return bids
