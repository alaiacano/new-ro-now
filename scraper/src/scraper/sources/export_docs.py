"""
Export doc_analysis results into JSON files consumed by the web frontend.

Produces files shaped to match existing data so the React app can merge them
into the existing tabs without special-casing DocumentCenter data.

Output files (all in data/):
  doc_map.json      — geo-tagged docs → new map layer
  doc_meetings.json — meeting minutes/agendas → merged into Meetings tab
  doc_news.json     — public hearings/press releases → merged into News tab
  doc_bids.json     — bids/RFPs found in docs → merged into Bids tab
  doc_explorer.json — all relevant docs → Document Explorer tab
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from rich.console import Console

from ..config import BASE_URL, DATA_DIR
from ..db import get_conn, init_db

console = Console()


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _load_analysis(conn) -> list[dict]:
    rows = conn.execute("""
        SELECT
            d.id,
            d.title,
            d.url,
            d.file_type,
            f.name  AS folder,
            f.path  AS folder_path,
            da.relevant,
            da.ui_tab,
            da.classification,
            da.summary,
            da.relevant_date,
            da.project_name,
            da.dollar_amount,
            da.location,
            da.coords_lat,
            da.coords_lng,
            da.tags,
            da.confidence
        FROM doc_analysis da
        JOIN documents d ON d.id = da.doc_id
        LEFT JOIN folders f ON f.id = d.folder_id
        WHERE da.relevant = 1
        ORDER BY da.relevant_date DESC, d.title
    """).fetchall()
    return [dict(r) for r in rows]


def _tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except Exception:
        return []


def _coords(row: dict) -> dict | None:
    if row["coords_lat"] and row["coords_lng"]:
        return {"lat": row["coords_lat"], "lng": row["coords_lng"]}
    return None


def export() -> dict[str, int]:
    init_db()
    conn = get_conn()
    rows = _load_analysis(conn)
    conn.close()

    console.print(f"  {len(rows)} relevant analyzed documents")

    # --- doc_map.json ---
    # Shape matches construction.json items (title, url, coords, source, description)
    map_docs = [
        {
            "id": r["id"],
            "title": r["title"] or f"Document {r['id']}",
            "url": r["url"],
            "description": r["summary"],
            "location": r["location"],
            "coords": _coords(r),
            "classification": r["classification"],
            "project_name": r["project_name"],
            "dollar_amount": r["dollar_amount"],
            "relevant_date": r["relevant_date"],
            "tags": _tags(r["tags"]),
            "folder": r["folder"],
            "source": "document_center",
        }
        for r in rows
        if _coords(r)
    ]

    # --- doc_meetings.json ---
    # Shape matches meetings.json items (id, calendar, title, start, url, description)
    meeting_docs = [
        {
            "id": f"doc-{r['id']}",
            "calendar": r["folder"] or "DocumentCenter",
            "title": r["title"] or f"Document {r['id']}",
            "start": r["relevant_date"] or None,
            "end": None,
            "location": r["location"],
            "url": r["url"],
            "description": r["summary"],
            "relevant_date": r["relevant_date"],
            "classification": r["classification"],
            "folder": r["folder"],
            "source": "document_center",
        }
        for r in rows
        if r["ui_tab"] == "meetings"
    ]

    # --- doc_news.json ---
    # Shape matches news.json items (title, url, description, published, category, source)
    news_docs = [
        {
            "title": r["title"] or f"Document {r['id']}",
            "url": r["url"],
            "description": r["summary"],
            "published": r["relevant_date"],
            "category": r["classification"],
            "relevant_date": r["relevant_date"],
            "classification": r["classification"],
            "folder": r["folder"],
            "source": "document_center",
        }
        for r in rows
        if r["ui_tab"] == "news"
    ]

    # --- doc_bids.json ---
    # Shape matches bids.json items (title, url, status, source)
    bid_docs = [
        {
            "title": r["title"] or f"Document {r['id']}",
            "url": r["url"],
            "status": r["relevant_date"] or "See document",
            "description": r["summary"],
            "relevant_date": r["relevant_date"],
            "classification": r["classification"],
            "folder": r["folder"],
            "source": "document_center",
        }
        for r in rows
        if r["ui_tab"] == "bids"
    ]

    # --- doc_explorer.json ---
    # All relevant docs with full metadata for the explorer view
    explorer_docs = [
        {
            "id": r["id"],
            "title": r["title"] or f"Document {r['id']}",
            "url": r["url"],
            "folder": r["folder"],
            "ui_tab": r["ui_tab"],
            "classification": r["classification"],
            "summary": r["summary"],
            "relevant_date": r["relevant_date"],
            "project_name": r["project_name"],
            "dollar_amount": r["dollar_amount"],
            "location": r["location"],
            "coords": _coords(r),
            "tags": _tags(r["tags"]),
            "confidence": r["confidence"],
        }
        for r in rows
    ]

    outputs = {
        "doc_map.json": map_docs,
        "doc_meetings.json": meeting_docs,
        "doc_news.json": news_docs,
        "doc_bids.json": bid_docs,
        "doc_explorer.json": explorer_docs,
    }

    counts = {}
    for filename, data in outputs.items():
        path = DATA_DIR / filename
        path.write_text(json.dumps(data, indent=2, default=str))
        counts[filename] = len(data)
        console.print(f"  [green]✓[/green] {len(data):>4} items → {path}")

    return counts
