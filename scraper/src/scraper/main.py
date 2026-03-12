"""
new-ro-monitor scraper CLI.

Usage (from repo root):
    uv run --project scraper scrape all
    uv run --project scraper scrape meetings
    uv run --project scraper scrape construction
    uv run --project scraper scrape library
    uv run --project scraper scrape bids
    uv run --project scraper scrape news
    uv run --project scraper scrape paving
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import typer
from rich.console import Console

from .config import DATA_DIR, META_FILE
from .sources import meetings as meetings_mod
from .sources import construction as construction_mod
from .sources import library as library_mod
from .sources import bids as bids_mod
from .sources import news as news_mod
from .sources import paving as paving_mod

app = typer.Typer(
    name="scrape",
    help="Scrape New Rochelle city data and write JSON to data/.",
    add_completion=False,
)
console = Console()


def _write(filename: str, data: object) -> Path:
    path = DATA_DIR / filename
    path.write_text(json.dumps(data, indent=2, default=str))
    return path


def _update_meta(keys: list[str]) -> None:
    meta: dict = {}
    if META_FILE.exists():
        meta = json.loads(META_FILE.read_text())
    now = datetime.now(tz=timezone.utc).isoformat()
    for k in keys:
        meta[k] = now
    META_FILE.write_text(json.dumps(meta, indent=2))


@app.command(name="all")
def cmd_all():
    """Scrape all sources."""
    cmd_meetings()
    cmd_construction()
    cmd_paving()
    cmd_library()
    cmd_bids()
    cmd_news()
    console.rule("[bold green]All done")


@app.command(name="meetings")
def cmd_meetings():
    """Scrape board/government meeting schedules via iCal."""
    console.rule("[bold blue]Meetings")
    data = meetings_mod.scrape()
    path = _write("meetings.json", data)
    _update_meta(["meetings"])
    console.print(f"[green]✓[/green] {len(data)} events → {path}")


@app.command(name="construction")
def cmd_construction():
    """Scrape roadway alerts and flood mitigation projects."""
    console.rule("[bold blue]Construction & Projects")
    data = construction_mod.scrape()
    path = _write("construction.json", data)
    _update_meta(["construction"])
    console.print(f"[green]✓[/green] {len(data)} projects → {path}")


@app.command(name="library")
def cmd_library():
    """Scrape library events from LibCal."""
    console.rule("[bold blue]Library Events")
    data = library_mod.scrape()
    path = _write("library_events.json", data)
    _update_meta(["library_events"])
    console.print(f"[green]✓[/green] {len(data)} events → {path}")


@app.command(name="bids")
def cmd_bids():
    """Scrape active city bids/contracts."""
    console.rule("[bold blue]City Bids")
    data = bids_mod.scrape()
    path = _write("bids.json", data)
    _update_meta(["bids"])
    console.print(f"[green]✓[/green] {len(data)} bids → {path}")


@app.command(name="paving")
def cmd_paving():
    """Scrape annual paving schedule from city PDFs."""
    console.rule("[bold blue]Paving Schedule")
    data = paving_mod.scrape()
    path = _write("paving.json", data)
    _update_meta(["paving"])
    console.print(f"[green]✓[/green] {len(data)} entries → {path}")


@app.command(name="news")
def cmd_news():
    """Scrape city news RSS and public hearing notices."""
    console.rule("[bold blue]News & Public Hearings")
    data = news_mod.scrape()
    news_path = _write("news.json", data["news"])
    hearings_path = _write("public_hearings.json", data["public_hearings"])
    _update_meta(["news", "public_hearings"])
    console.print(f"[green]✓[/green] {len(data['news'])} news items → {news_path}")
    console.print(f"[green]✓[/green] {len(data['public_hearings'])} hearings → {hearings_path}")
