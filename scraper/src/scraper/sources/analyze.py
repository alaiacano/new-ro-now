"""
Analyze downloaded DocumentCenter documents using a local LLM via OpenAI-compatible API.

Reads extracted text from doc_text, sends to local vLLM server, stores structured
results in doc_analysis. Results are used by export-docs to feed into the existing
UI tabs (map pins, meetings, bids, news, calendar).

Setup:
    Start vLLM: vllm serve Qwen/Qwen2.5-32B-Instruct --quantization awq
    Then: uv run scrape analyze --model Qwen/Qwen2.5-32B-Instruct

Idempotent: skips docs already in doc_analysis unless --reanalyze is passed.
"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from openai import OpenAI
from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, SpinnerColumn, TextColumn

from ..db import get_conn, init_db, log_step
from ..geocoder import geocode_address

console = Console()

DEFAULT_API_URL = "http://localhost:8000/v1"
DEFAULT_MODEL = "Qwen/Qwen2.5-32B-Instruct"
MAX_TEXT_CHARS = 12000       # chars from the start of the document
MAX_TEXT_CHARS_TAIL = 3000  # additional chars from the end (for long PDFs)

SYSTEM_PROMPT = """You are a document analyst for New Rochelle, NY city government records.
Your job is to decide whether a document is useful for a civic information app and, if so, where it belongs.

The app has these sections:
- map: projects, permits, construction, road work, or any document tied to a specific location
- meetings: meeting minutes, agendas, schedules for any city board or committee
- bids: procurement, RFPs, contracts, purchasing
- news: press releases, public hearing notices, announcements, ordinances
- paving: road paving schedules or related infrastructure

IMPORTANT — distinguish completed documents from blank templates:
- A COMPLETED document has actual content: specific names, dates, decisions, dollar amounts, addresses.
- A BLANK TEMPLATE or FORM has empty fields (underscores, brackets, "Name: ___", checkboxes with no selections, placeholder text like "[insert date]"). These are for residents to fill out and submit — they contain no civic information themselves. Classify these as "form_template" and mark relevant=false.

Other non-relevant documents: event flyers, sports schedules, social media assets, internal logos, bake sale notices, photos. Mark these relevant=false too.

Return JSON only. No markdown. No explanation outside the JSON."""

USER_PROMPT_TEMPLATE = """Analyze this New Rochelle city government document.

Title: {title}
Folder: {folder}
File type: {file_type}
{text_section}

Return JSON with exactly these fields:
{{
  "relevant": <true if this document contains actual civic information useful to a resident, false if it is a blank form/template, flyer, sports schedule, image, or other low-value item>,
  "ui_tab": "<which app section this belongs in: map | meetings | bids | news | paving | none>",
  "classification": "<specific document type: meeting_minutes | agenda | budget | permit | construction | public_hearing | ordinance | bid | report | paving_schedule | press_release | environmental_review | form_template | other>",
  "summary": "<2-3 sentence plain-English summary of what this document is about and why it matters to a resident. null if not relevant.>",
  "relevant_date": "<the date this document is ABOUT in YYYY-MM-DD, or YYYY if only year is known, or null>",
  "project_name": "<specific named project, development, or initiative if any, else null>",
  "dollar_amount": "<primary dollar figure e.g. '$2.4M', or null>",
  "location": "<street address, intersection, neighborhood, or district in New Rochelle this document concerns — be as specific as the document allows. null if not location-specific.>",
  "tags": ["<3-5 short keyword tags>"],
  "confidence": <float 0.0-1.0>
}}"""


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _build_prompt(title: str, folder: str, file_type: str, text: str | None) -> str:
    if text and text.strip():
        if len(text) <= MAX_TEXT_CHARS + MAX_TEXT_CHARS_TAIL:
            excerpt = text
        else:
            # Sample start + end so long PDFs aren't just their table of contents
            head = text[:MAX_TEXT_CHARS]
            tail = text[-MAX_TEXT_CHARS_TAIL:]
            excerpt = head + "\n\n[... middle truncated ...]\n\n" + tail
        text_section = f"Extracted text:\n{excerpt}"
    else:
        text_section = "(No text could be extracted — classify based on title and folder only.)"

    return USER_PROMPT_TEMPLATE.format(
        title=title,
        folder=folder,
        file_type=file_type or "unknown",
        text_section=text_section,
    )


def _parse_response(content: str) -> dict:
    """Extract JSON from model response, handling markdown fences if present."""
    if content is None:
        raise ValueError("Model returned null content")
    # Strip markdown code fences if model ignored instructions
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\n?", "", content)
        content = re.sub(r"\n?```$", "", content)
    return json.loads(content)


def _analyze_one(client: OpenAI, model: str, doc: dict) -> dict | None:
    """
    Call the LLM for one document. Returns parsed result dict or None on failure.
    doc keys: id, title, folder_path, file_type, text
    """
    prompt = _build_prompt(
        title=doc["title"] or f"Document {doc['id']}",
        folder=doc["folder_path"] or "Unknown",
        file_type=doc["file_type"],
        text=doc["text"],
    )

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=8192,
            response_format={"type": "json_object"},
            extra_body={"disable_free_form_reasoning": True},
        )
        content = response.choices[0].message.content
        if content is None:
            reasoning = getattr(response.choices[0].message, "reasoning", None)
            raise RuntimeError(
                f"Model returned null content (finish_reason={response.choices[0].finish_reason}). "
                f"Reasoning: {reasoning[:200] if reasoning else '(none)'}"
            )
        return _parse_response(content)
    except Exception as e:
        # Include response body if available (e.g. from openai.APIStatusError)
        body = getattr(e, "response", None)
        if body is not None:
            try:
                detail = body.text
            except Exception:
                detail = str(body)
            raise RuntimeError(f"LLM call failed ({type(e).__name__}): {e} | response: {detail}") from e
        raise RuntimeError(f"LLM call failed ({type(e).__name__}): {e}") from e


def _get_pending(
    conn,
    limit: int | None,
    folder_id: int | None,
    reanalyze: bool,
    min_text_len: int | None = None,
    max_text_len: int | None = None,
) -> list[dict]:
    """Query docs that need analysis, joining with doc_text and folders."""
    if reanalyze:
        where = "1=1"
    else:
        where = "da.doc_id IS NULL"

    folder_filter = ""
    params: list = []
    if folder_id is not None:
        # Get subtree of folder IDs
        subtree = [folder_id]
        queue = [folder_id]
        while queue:
            parent = queue.pop()
            for row in conn.execute("SELECT id FROM folders WHERE parent_id=?", (parent,)):
                subtree.append(row["id"])
                queue.append(row["id"])
        placeholders = ",".join("?" * len(subtree))
        folder_filter = f"AND d.folder_id IN ({placeholders})"
        params.extend(subtree)

    text_len_filter = ""
    if min_text_len is not None:
        text_len_filter += f" AND length(dt.text) >= {min_text_len}"
    if max_text_len is not None:
        text_len_filter += f" AND length(dt.text) <= {max_text_len}"

    query = f"""
        SELECT
            d.id,
            d.title,
            d.file_type,
            d.url,
            f.path AS folder_path,
            f.name AS folder_name,
            dt.text
        FROM documents d
        LEFT JOIN doc_analysis da ON da.doc_id = d.id
        LEFT JOIN doc_text dt ON dt.doc_id = d.id
        LEFT JOIN folders f ON f.id = d.folder_id
        WHERE {where}
          AND d.downloaded_at IS NOT NULL
          {folder_filter}
          {text_len_filter}
        ORDER BY d.id
    """
    if limit:
        query += f" LIMIT {limit}"

    rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]


def analyze(
    api_url: str = DEFAULT_API_URL,
    model: str = DEFAULT_MODEL,
    limit: int | None = None,
    folder_id: int | None = None,
    reanalyze: bool = False,
    concurrency: int = 2,
    min_text_len: int | None = None,
    max_text_len: int | None = None,
) -> None:
    init_db()
    conn = get_conn()
    now = _now()

    pending = _get_pending(conn, limit, folder_id, reanalyze, min_text_len, max_text_len)
    console.print(f"  {len(pending)} documents to analyze")
    console.print(f"  Model: {model}  API: {api_url}  Concurrency: {concurrency}")

    if not pending:
        conn.close()
        return

    client = OpenAI(base_url=api_url, api_key="local")

    # Verify the server is reachable before starting
    try:
        client.models.list()
    except Exception as e:
        console.print(f"  [red]Cannot reach LLM server at {api_url}: {e}[/red]")
        console.print("  Start vLLM first: vllm serve <model> --quantization awq")
        conn.close()
        return

    ok = err = 0
    geo_cache: dict = {}

    def process(doc: dict) -> tuple[int, dict | None, str | None]:
        try:
            result = _analyze_one(client, model, doc)
            return doc["id"], result, None
        except Exception as e:
            return doc["id"], None, str(e)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        MofNCompleteColumn(),
        console=console,
    ) as progress:
        task = progress.add_task("Analyzing...", total=len(pending))

        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = {pool.submit(process, doc): doc for doc in pending}
            for future in as_completed(futures):
                doc = futures[future]
                doc_id = doc["id"]
                progress.advance(task)

                doc_id, result, error = future.result()

                if error or result is None:
                    err += 1
                    msg = error or "null result"
                    console.print(f"  [red]✗ doc {doc_id}:[/red] {msg}")
                    log_step(conn, doc_id, "analyze", "error", msg)
                    conn.commit()
                    continue

                ok += 1

                # Geocode location if present
                coords_lat = coords_lng = None
                location = result.get("location")
                if location:
                    coords = geocode_address(location, geo_cache)
                    if coords:
                        coords_lat = coords["lat"]
                        coords_lng = coords["lng"]

                conn.execute(
                    """INSERT OR REPLACE INTO doc_analysis
                       (doc_id, analyzed_at, model, relevant, ui_tab, classification,
                        summary, relevant_date, project_name, dollar_amount, location,
                        coords_lat, coords_lng, tags, confidence)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        doc_id,
                        now,
                        model,
                        1 if result.get("relevant") else 0,
                        result.get("ui_tab"),
                        result.get("classification"),
                        result.get("summary"),
                        result.get("relevant_date"),
                        result.get("project_name"),
                        result.get("dollar_amount"),
                        location,
                        coords_lat,
                        coords_lng,
                        json.dumps(result.get("tags") or []),
                        result.get("confidence"),
                    ),
                )
                log_step(conn, doc_id, "analyze", "ok", f"{result.get('ui_tab')}/{result.get('classification')}")
                conn.commit()

    console.print(f"\n  [green]✓ {ok} analyzed[/green]  [red]{err} errors[/red]")
    conn.close()
