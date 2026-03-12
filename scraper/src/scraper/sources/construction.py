"""
Scrape active construction / roadway projects.

Sources:
  1. Roadway Alerts hub (/762) + individual project sub-pages
  2. Flood Mitigation Projects (/1831)

Both sources attempt geocoding on addresses found in the content.
"""
import re

import httpx
from bs4 import BeautifulSoup
from rich.console import Console

from ..config import BASE_URL, FLOOD_PROJECTS_URL, ROADWAY_ALERTS_URL
from ..geocoder import geocode_many

console = Console()


def _get_soup(url: str) -> BeautifulSoup | None:
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "new-ro-monitor/1.0"})
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        console.print(f"  [red]Error fetching {url}: {e}[/red]")
        return None


def _extract_roadway_projects() -> list[dict]:
    """Scrape /762/Roadway-Alerts hub and each linked project page."""
    projects = []
    soup = _get_soup(ROADWAY_ALERTS_URL)
    if not soup:
        return projects

    # CivicPlus CMS puts the actual content links in div.moduleContentNew.
    # These links use newrochelleny.com (not .gov) as the domain.
    content_div = soup.find("div", class_="moduleContentNew")
    if not content_div:
        # Fallback: search entire page for project links
        content_div = soup

    skip_paths = {"/762/Roadway-Alerts", "/762"}
    project_links = []
    seen_titles = set()

    for a in content_div.find_all("a", href=True):
        href = a["href"]
        title = a.get_text(strip=True)
        if not title or title in seen_titles:
            continue
        # Match both /NNN/slug and full newrochelleny.com URLs with that pattern
        is_gov_path = re.match(r"^/\d{3,}/", href)
        is_full_url = re.search(r"newrochelleny\.(?:gov|com)/(\d{3,}/)", href)
        if (is_gov_path or is_full_url) and href not in skip_paths:
            if is_full_url:
                # Normalize to .gov
                slug = is_full_url.group(1)
                full_url = BASE_URL + "/" + slug.rstrip("/")
            else:
                full_url = BASE_URL + href
            project_links.append((title, full_url))
            seen_titles.add(title)

    if not project_links:
        console.print("  [yellow]No project links found on roadway alerts hub[/yellow]")

    for title, url in project_links:
        console.print(f"    Fetching project: [cyan]{title}[/cyan]")
        proj_soup = _get_soup(url)
        if not proj_soup:
            projects.append({
                "title": title,
                "url": url,
                "description": None,
                "addresses": _extract_street_names(title, title),
                "coords": None,
                "source": "roadway_alerts",
            })
            continue

        # Extract main content text
        main = (proj_soup.find("div", class_="fr-view")
                or proj_soup.find("div", id="contentMain")
                or proj_soup.find("main"))
        text = main.get_text(separator="\n", strip=True) if main else ""

        # Try to extract street addresses from text
        # Patterns: "Webster Avenue", "North Avenue", named streets
        addresses = _extract_street_names(text, title)
        if not addresses:
            addresses = _extract_street_names(title, title)

        projects.append({
            "title": title,
            "url": url,
            "description": text[:1000] if text else None,
            "addresses": addresses,
            "coords": None,  # filled in by geocoding pass
            "source": "roadway_alerts",
        })

    return projects


def _extract_flood_projects() -> list[dict]:
    """Scrape /1831/Flood-Mitigation-Projects."""
    projects = []
    soup = _get_soup(FLOOD_PROJECTS_URL)
    if not soup:
        return projects

    # Projects appear as tab panels or sections with consistent ID pattern (e.g. 24-007)
    # Try to find project ID patterns in headings or strong tags
    main = (soup.find("div", class_="fr-view")
            or soup.find("div", id="contentMain")
            or soup.find("main"))
    if not main:
        return projects

    # Look for project headings - they contain project IDs like "24-007"
    # Try headings first
    headings = main.find_all(re.compile(r"^h[1-6]$"))
    # Also try strong tags and list items for project entries
    if not headings:
        headings = main.find_all("strong")

    current_project = None
    full_text = main.get_text(separator="\n", strip=True)

    # Parse project ID pattern from text
    # Format observed: project ID (NN-NNN), project name, street addresses
    project_pattern = re.compile(r"\b(\d{2}-\d{3})\b")
    matches = list(project_pattern.finditer(full_text))

    if matches:
        # Split text by project ID occurrences
        text_lines = full_text.split("\n")
        project_blocks: list[dict] = []
        current: dict | None = None

        for line in text_lines:
            m = project_pattern.search(line)
            if m:
                if current:
                    project_blocks.append(current)
                current = {
                    "project_id": m.group(1),
                    "title": line.strip(),
                    "lines": [],
                }
            elif current:
                if line.strip():
                    current["lines"].append(line.strip())

        if current:
            project_blocks.append(current)

        for block in project_blocks:
            description = " ".join(block["lines"][:5])
            # Try description first; fall back to title (which often contains street names)
            addresses = _extract_street_names(description, block["title"])
            if not addresses:
                addresses = _extract_street_names(block["title"], block["title"])
            projects.append({
                "project_id": block["project_id"],
                "title": block["title"],
                "url": FLOOD_PROJECTS_URL,
                "description": description or None,
                "addresses": addresses,
                "coords": None,
                "source": "flood_mitigation",
            })
    else:
        # Fallback: return full page as one entry
        projects.append({
            "title": "Flood Mitigation Projects",
            "url": FLOOD_PROJECTS_URL,
            "description": full_text[:1000],
            "addresses": [],
            "coords": None,
            "source": "flood_mitigation",
        })

    return projects


def _extract_street_names(text: str, fallback_title: str) -> list[str]:
    """
    Extract clean street names from free text for geocoding.

    Strategy:
    1. Split text on "AND" / "," / "-" separators so each segment is scanned
       individually — prevents the greedy regex from swallowing compound names
       like "HARMON DRIVE AND STORER AVENUE" as one pattern match.
    2. Match "Name Suffix" in each segment.
    """
    if not text:
        return []

    # Split on common connectors in project titles/descriptions
    segments = re.split(r"\band\b|,|;|\s+-\s+", text, flags=re.IGNORECASE)

    suffix = (
        r"(Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|"
        r"Place|Pl|Court|Ct|Way|Terrace|Ter|Highway|Hwy|Parkway|Pkwy|"
        r"Crescent|Circle|Path)"
    )
    pattern = re.compile(
        r"\b(\d{1,5}\s+)?([A-Za-z]{2,20}(?:\s+[A-Za-z]{2,20}){0,2})\s+" + suffix + r"\b",
        re.IGNORECASE,
    )

    noise = {"the", "a", "an", "this", "that", "its", "with", "limited", "detoured",
             "southbound", "northbound", "eastbound", "westbound", "traffic", "stage",
             "will", "be", "at"}

    found: list[str] = []
    seen: set[str] = set()

    for seg in segments:
        for m in pattern.finditer(seg):
            name_part = m.group(2).strip()
            suf_part = m.group(3).strip()

            if len(name_part.split()) > 3:
                continue
            if name_part.lower() in noise or any(w.lower() in noise for w in name_part.split()):
                continue

            addr = f"{name_part.title()} {suf_part.title()}".strip()
            key = addr.lower()
            if key not in seen:
                seen.add(key)
                found.append(addr)

    return found[:5]


def scrape() -> list[dict]:
    console.print("  Fetching roadway alerts...")
    roadway = _extract_roadway_projects()
    console.print(f"  → {len(roadway)} roadway projects")

    console.print("  Fetching flood mitigation projects...")
    flood = _extract_flood_projects()
    console.print(f"  → {len(flood)} flood projects")

    all_projects = roadway + flood

    # Geocode all addresses
    all_addresses = []
    for p in all_projects:
        all_addresses.extend(p.get("addresses", []))

    if all_addresses:
        console.print(f"  Geocoding {len(all_addresses)} addresses...")
        geo = geocode_many(all_addresses)

        for p in all_projects:
            addrs = p.get("addresses", [])
            # Use the first address that resolves successfully
            for addr in addrs:
                coords = geo.get(addr)
                if coords:
                    p["coords"] = coords
                    break

    return all_projects
