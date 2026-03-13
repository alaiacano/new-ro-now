"""
SQLite database for DocumentCenter mirror.

Schema lives in data/documents.db (gitignored).
Call init_db() before using any other function.
"""
import sqlite3
from datetime import datetime, timezone

from .config import DB_FILE


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS folders (
                id            INTEGER PRIMARY KEY,
                parent_id     INTEGER,
                name          TEXT NOT NULL,
                path          TEXT,
                discovered_at TEXT
            );

            CREATE TABLE IF NOT EXISTS documents (
                id              INTEGER PRIMARY KEY,
                folder_id       INTEGER REFERENCES folders(id),
                title           TEXT,
                url             TEXT,
                file_type       TEXT,
                file_size_bytes INTEGER,
                published_date  TEXT,
                discovered_at   TEXT,
                downloaded_at   TEXT,
                local_path      TEXT,
                download_error  TEXT
            );

            CREATE TABLE IF NOT EXISTS doc_text (
                doc_id       INTEGER PRIMARY KEY REFERENCES documents(id),
                extracted_at TEXT,
                method       TEXT,
                text         TEXT
            );

            CREATE TABLE IF NOT EXISTS doc_analysis (
                doc_id         INTEGER PRIMARY KEY REFERENCES documents(id),
                analyzed_at    TEXT,
                model          TEXT,
                relevant       INTEGER,  -- 1=yes, 0=no
                ui_tab         TEXT,     -- map|meetings|bids|news|paving|none
                classification TEXT,
                summary        TEXT,
                relevant_date  TEXT,
                project_name   TEXT,
                dollar_amount  TEXT,
                location       TEXT,     -- raw location string (broader than address)
                coords_lat     REAL,
                coords_lng     REAL,
                tags           TEXT,
                confidence     REAL
            );

            CREATE TABLE IF NOT EXISTS processing_log (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id  INTEGER,
                step    TEXT,
                status  TEXT,
                message TEXT,
                ts      TEXT
            );
        """)


def log_step(conn: sqlite3.Connection, doc_id: int | None, step: str, status: str, message: str = "") -> None:
    conn.execute(
        "INSERT INTO processing_log (doc_id, step, status, message, ts) VALUES (?,?,?,?,?)",
        (doc_id, step, status, message, datetime.now(tz=timezone.utc).isoformat()),
    )
