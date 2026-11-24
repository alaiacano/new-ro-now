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
    uv run --project scraper scrape discover
    uv run --project scraper scrape download [--limit N] [--folder-id F] [--retry-errors]
    uv run --project scraper scrape analyze [--limit N] [--folder-id F] [--reanalyze] [--api-url URL] [--model NAME] [--concurrency N]
  → Default concurrency=2 for single GPU, do not increase beyond 3
    uv run --project scraper scrape export-docs

  Permits (Municity 5 / CitySquared backend → data/permits.db, gitignored):
    uv run --project scraper scrape permits full          # baseline load (run once)
    uv run --project scraper scrape permits sync          # routine: new apps + status changes
    uv run --project scraper scrape permits update-open   # re-check only open applications
    uv run --project scraper scrape permits export        # write permits_public/full.json
    uv run --project scraper scrape permits stats         # summarize the DB
    uv run --project scraper scrape permits query "SQL"   # ad-hoc read-only SQL
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

from .config import DATA_DIR, META_FILE
from .sources import meetings as meetings_mod
from .sources import construction as construction_mod
from .sources import library as library_mod
from .sources import bids as bids_mod
from .sources import news as news_mod
from .sources import paving as paving_mod
from .sources import docenter as docenter_mod
from .sources import analyze as analyze_mod
from .sources import export_docs as export_docs_mod
from .sources import permits as permits_mod

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


@app.command(name="discover")
def cmd_discover():
    """
    Walk the DocumentCenter folder tree (via Playwright) and record all
    document metadata in data/documents.db. Safe to re-run — only adds new records.

    Requires Playwright Chromium: run `playwright install chromium` after uv sync.
    """
    console.rule("[bold blue]DocumentCenter Discovery")
    docenter_mod.discover()


@app.command(name="download")
def cmd_download(
    limit: Optional[int] = typer.Option(None, "--limit", "-n", help="Max number of files to download"),
    folder_id: Optional[int] = typer.Option(None, "--folder-id", "-f", help="Only download docs in this folder subtree"),
    retry_errors: bool = typer.Option(False, "--retry-errors", help="Retry previously failed downloads"),
):
    """
    Download all discovered documents to data/doc_cache/. Extracts text from
    PDFs and DOCX files. Safe to re-run — skips already-downloaded files.

    Run `scrape discover` first to populate the document list.
    """
    console.rule("[bold blue]DocumentCenter Download")
    docenter_mod.download(limit=limit, folder_id=folder_id, retry_errors=retry_errors)


@app.command(name="analyze")
def cmd_analyze(
    limit: Optional[int] = typer.Option(None, "--limit", "-n", help="Max docs to analyze"),
    folder_id: Optional[int] = typer.Option(None, "--folder-id", "-f", help="Only analyze docs in this folder subtree"),
    reanalyze: bool = typer.Option(False, "--reanalyze", help="Re-analyze already-analyzed docs"),
    api_url: str = typer.Option("http://localhost:8000/v1", "--api-url", help="OpenAI-compatible API base URL"),
    model: str = typer.Option("qwen38-27b", "--model", help="Model name as registered in vLLM"),
    concurrency: int = typer.Option(2, "--concurrency", "-c", help="Parallel requests to LLM"),
    min_text_len: Optional[int] = typer.Option(None, "--min-text-len", help="Only analyze docs with extracted text >= N chars"),
    max_text_len: Optional[int] = typer.Option(None, "--max-text-len", help="Only analyze docs with extracted text <= N chars"),
):
    """
    Classify and extract structured data from downloaded documents using a local LLM.

    Start vLLM first:
        vllm serve Qwen/Qwen2.5-32B-Instruct --quantization awq --max-model-len 8192

    Results feed into the existing UI tabs via `scrape export-docs`.

    To re-analyze only docs that were previously truncated (benefiting from the higher
    character limit), use --reanalyze with --min-text-len and --max-text-len:

        uv run scrape analyze --reanalyze --min-text-len 5500 --max-text-len 500000 ...
    """
    console.rule("[bold blue]DocumentCenter Analysis")
    analyze_mod.analyze(
        api_url=api_url,
        model=model,
        limit=limit,
        folder_id=folder_id,
        reanalyze=reanalyze,
        concurrency=concurrency,
        min_text_len=min_text_len,
        max_text_len=max_text_len,
    )


# ---------------------------------------------------------------------------
# Permits (Municity 5 / CitySquared backend) — see sources/permits.py
# ---------------------------------------------------------------------------
permits_app = typer.Typer(
    name="permits",
    help="Sync New Rochelle permit applications from Municity 5 into data/permits.db.",
    add_completion=False,
)
app.add_typer(permits_app)


@permits_app.command(name="full")
def cmd_permits_full():
    """Baseline load / full rebuild: upsert every application (run once)."""
    console.rule("[bold blue]Permits — full sync")
    permits_mod.sync_full()
    _update_meta(["permits"])


@permits_app.command(name="sync")
def cmd_permits_sync():
    """Routine pass: add new applications and record status transitions."""
    console.rule("[bold blue]Permits — incremental sync")
    permits_mod.sync_incremental()
    _update_meta(["permits"])


@permits_app.command(name="update-open")
def cmd_permits_update_open():
    """Re-check only currently-open applications for a decision (granted/denied/closed)."""
    console.rule("[bold blue]Permits — update open applications")
    permits_mod.sync_update_open()
    _update_meta(["permits"])


@permits_app.command(name="export")
def cmd_permits_export():
    """Write permits_public.json (no PII) and permits_full.json (with PII)."""
    console.rule("[bold blue]Permits — export JSON")
    permits_mod.export_json()


@permits_app.command(name="stats")
def cmd_permits_stats():
    """Print a summary of the permits database."""
    permits_mod.print_stats()


@permits_app.command(name="query")
def cmd_permits_query(
    sql: str = typer.Argument(..., help="SQL to run against permits.db"),
    limit: int = typer.Option(50, "--limit", "-n", help="Max rows to display"),
):
    """Run ad-hoc read-only SQL against data/permits.db and print a table."""
    permits_mod.run_query(sql, limit=limit)


@app.command(name="export-docs")
def cmd_export_docs():
    """
    Export analyzed DocumentCenter documents to JSON files for the web frontend.

    Reads doc_analysis from data/documents.db and writes:
      doc_map.json       — geo-tagged docs → Map tab
      doc_meetings.json  — meeting minutes/agendas → Meetings tab
      doc_news.json      — hearings/press releases → News tab
      doc_bids.json      — bids/RFPs → Bids tab
      doc_explorer.json  — all relevant docs (full metadata)
    """
    console.rule("[bold blue]Export DocumentCenter Docs")
    counts = export_docs_mod.export()
    _update_meta(["doc_analysis"])
