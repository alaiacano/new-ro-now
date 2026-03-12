"""
Scrape the annual paving schedule from PDF files on /948/Paving.

The city publishes one citywide list and one downtown list each year as PDFs.
PDF links change annually, so we re-fetch the Paving page to find current URLs.

PDF table format (text-based, parseable with pypdf):
    # Street              To                   From
    1 Allard Ave          Main St              John St
    2 Baraud Rd           N Severn St          Wilmot Rd
    ...
"""
import os
import re
import tempfile

import httpx
import pypdf
from bs4 import BeautifulSoup
from rich.console import Console

from ..config import BASE_URL
from ..geocoder import geocode_many

console = Console()

PAVING_PAGE_URL = f"{BASE_URL}/948/Paving"

# Terminals that should not be geocoded as cross streets
_TERMINALS = {"dead end", "cul-de-sac", "end to end"}


def _fetch_pdf_urls() -> dict[str, str]:
    """
    Scrape /948/Paving and return {'citywide': url, 'downtown': url}.
    Falls back to empty dict if links can't be found.
    """
    try:
        resp = httpx.get(PAVING_PAGE_URL, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
    except Exception as e:
        console.print(f"  [red]Could not fetch paving page: {e}[/red]")
        return {}

    soup = BeautifulSoup(resp.text, "html.parser")
    urls: dict[str, str] = {}

    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True).lower()
        if "documentcenter/view" not in href.lower():
            continue
        full = href if href.startswith("http") else BASE_URL + href
        if "downtown" in text:
            urls["downtown"] = full
        elif "paving" in text or "citywide" in text or "city" in text:
            urls["citywide"] = full

    return urls


def _download_pdf(url: str) -> str | None:
    """Download a PDF to a temp file, return the path (caller must delete)."""
    try:
        resp = httpx.get(url, timeout=30, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
    except Exception as e:
        console.print(f"  [red]Could not download PDF {url}: {e}[/red]")
        return None

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(resp.content)
        return f.name


def _extract_year(text: str) -> int | None:
    """Pull the first 4-digit year out of extracted PDF text."""
    m = re.search(r"\b(20\d{2})\b", text)
    return int(m.group(1)) if m else None


def _parse_pdf_text(text: str, list_name: str) -> list[dict]:
    """
    Parse the paving table from layout-mode extracted PDF text.

    extraction_mode='layout' pads columns with whitespace, so data columns
    are reliably separated by 2+ spaces. Row lines start with a row number.
    Title/header lines are excluded by filtering out year-number false matches.
    """
    entries = []
    lines = text.split("\n")
    year = _extract_year(text)

    # Row number must be a plausible index (not a year like 2025)
    row_pattern = re.compile(r"^\s*(\d{1,3})\s{2,}(.+)$")

    for line in lines:
        m = row_pattern.match(line)
        if not m:
            continue

        row_num = int(m.group(1))
        rest = m.group(2)

        # Split the remaining columns on 2+ spaces
        cols = re.split(r"\s{2,}", rest.strip())
        street_raw = cols[0].strip() if cols else ""
        to_val = cols[1].strip() if len(cols) > 1 else ""
        from_val = cols[2].strip() if len(cols) > 2 else ""

        if not street_raw:
            continue

        note = "*" if street_raw.endswith("*") else None
        street = street_raw.rstrip("*").strip()

        entries.append({
            "row": row_num,
            "street": street,
            "to": to_val or None,
            "from": from_val or None,
            "list": list_name,
            "year": year,
            "coords": None,
            "note": note,
        })

    return entries


def _parse_pdf(path: str, list_name: str) -> list[dict]:
    try:
        reader = pypdf.PdfReader(path)
        # layout mode preserves column whitespace, enabling 2+-space column splits
        full_text = "\n".join(
            page.extract_text(extraction_mode="layout") or "" for page in reader.pages
        )
        return _parse_pdf_text(full_text, list_name)
    except Exception as e:
        console.print(f"  [red]Failed to parse PDF ({list_name}): {e}[/red]")
        return []


def scrape() -> list[dict]:
    console.print("  Fetching paving page to find PDF links...")
    pdf_urls = _fetch_pdf_urls()

    if not pdf_urls:
        console.print("  [yellow]No PDF links found on paving page.[/yellow]")
        return []

    all_entries: list[dict] = []

    for list_name in ("citywide", "downtown"):
        url = pdf_urls.get(list_name)
        if not url:
            console.print(f"  [yellow]No {list_name} PDF found.[/yellow]")
            continue

        console.print(f"  Downloading {list_name} PDF...")
        path = _download_pdf(url)
        if not path:
            continue

        try:
            entries = _parse_pdf(path, list_name)
        finally:
            os.unlink(path)

        year = entries[0]["year"] if entries else "?"
        console.print(f"    → {len(entries)} streets ({year})")
        all_entries.extend(entries)

    # Geocode: one lookup per unique street name (deduplicate downtown repeats)
    unique_streets = list({e["street"] for e in all_entries})
    console.print(f"  Geocoding {len(unique_streets)} unique street names...")
    geo = geocode_many(unique_streets)

    for entry in all_entries:
        entry["coords"] = geo.get(entry["street"])

    mapped = sum(1 for e in all_entries if e["coords"])
    console.print(f"  {mapped}/{len(all_entries)} entries geocoded")

    return all_entries
