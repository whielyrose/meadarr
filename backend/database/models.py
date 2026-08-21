"""
Meadarr Database Models
SQLite with WAL mode for concurrent reads.
All settings stored here (no .env needed beyond port/paths).
"""
import sqlite3
import logging
from pathlib import Path

log = logging.getLogger("meadarr.db")

DB_PATH = Path("/app/data/meadarr.db")


def get_connection() -> sqlite3.Connection:
    """Get a database connection with row factory and WAL mode."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Create all tables if they don't exist."""
    conn = get_connection()
    try:
        conn.executescript("""
        -- ── Settings ──────────────────────────────────────────────────────
        -- Key/value store for all app configuration (replaces .env)
        CREATE TABLE IF NOT EXISTS settings (
            key     TEXT PRIMARY KEY,
            value   TEXT,
            updated_at INTEGER DEFAULT (strftime('%s','now'))
        );

        -- ── Library ───────────────────────────────────────────────────────
        -- Tracks every file we know about to prevent duplicate downloads
        CREATE TABLE IF NOT EXISTS library_tracks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            mbid            TEXT,           -- MusicBrainz recording ID (most reliable dedup key)
            release_mbid    TEXT,           -- MusicBrainz release group ID
            artist          TEXT NOT NULL,
            album           TEXT NOT NULL,
            title           TEXT NOT NULL,
            year            INTEGER,
            track_number    INTEGER,
            disc_number     INTEGER DEFAULT 1,
            duration_ms     INTEGER,
            format          TEXT,           -- mp3, flac, etc
            bitrate         INTEGER,        -- kbps
            file_path       TEXT UNIQUE,    -- absolute path on disk
            file_size       INTEGER,        -- bytes
            upgrade_available INTEGER DEFAULT 0, -- 1 if better quality exists
            added_at        INTEGER DEFAULT (strftime('%s','now')),
            scanned_at      INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_library_mbid ON library_tracks(mbid);
        CREATE INDEX IF NOT EXISTS idx_library_artist ON library_tracks(artist COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_library_album ON library_tracks(album COLLATE NOCASE);

        -- ── Download Requests ──────────────────────────────────────────────
        -- Everything the user has asked to download
        CREATE TABLE IF NOT EXISTS requests (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            type            TEXT NOT NULL,  -- 'album' or 'track'
            mbid            TEXT,           -- MusicBrainz release group or recording ID
            artist          TEXT NOT NULL,
            album           TEXT,
            title           TEXT,           -- for track requests
            year            INTEGER,
            format_pref     TEXT DEFAULT 'mp3', -- preferred format
            status          TEXT DEFAULT 'pending',
            -- status: pending | searching | downloading | processing | completed | failed | duplicate
            error_message   TEXT,
            retry_count     INTEGER DEFAULT 0,
            requested_at    INTEGER DEFAULT (strftime('%s','now')),
            completed_at    INTEGER,
            download_id     TEXT            -- slskd download task ID
        );
        CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
        CREATE INDEX IF NOT EXISTS idx_requests_mbid ON requests(mbid);

        -- ── Download Tasks ──────────────────────────────────────────────────
        -- Individual file downloads from slskd (one request can have many tracks)
        CREATE TABLE IF NOT EXISTS download_tasks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id      INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            slskd_id        TEXT,           -- slskd transfer ID
            peer            TEXT,           -- soulseek username of peer
            filename        TEXT NOT NULL,
            expected_size   INTEGER,
            downloaded_size INTEGER DEFAULT 0,
            status          TEXT DEFAULT 'queued',
            -- status: queued | downloading | completed | failed | cancelled
            dest_path       TEXT,           -- final destination after move
            created_at      INTEGER DEFAULT (strftime('%s','now')),
            completed_at    INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_request ON download_tasks(request_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_slskd ON download_tasks(slskd_id);

        -- ── Playlists ──────────────────────────────────────────────────────
        -- Playlists we manage (synced to Jellyfin)
        CREATE TABLE IF NOT EXISTS playlists (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            name            TEXT NOT NULL UNIQUE,
            description     TEXT,
            jellyfin_id     TEXT,           -- Jellyfin playlist ID once synced
            auto_generated  INTEGER DEFAULT 0, -- 1 if created by discovery/lastfm
            created_at      INTEGER DEFAULT (strftime('%s','now')),
            updated_at      INTEGER DEFAULT (strftime('%s','now'))
        );

        -- ── Playlist Tracks ─────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id     INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
            library_track_id INTEGER REFERENCES library_tracks(id) ON DELETE SET NULL,
            jellyfin_item_id TEXT,          -- Jellyfin item ID for direct reference
            artist          TEXT,
            album           TEXT,
            title           TEXT,
            position        INTEGER NOT NULL,
            added_at        INTEGER DEFAULT (strftime('%s','now')),
            PRIMARY KEY (playlist_id, position)
        );

        -- ── Search Cache ────────────────────────────────────────────────────
        -- Cache MusicBrainz and Last.fm results to respect rate limits
        CREATE TABLE IF NOT EXISTS search_cache (
            cache_key       TEXT PRIMARY KEY,
            result_json     TEXT NOT NULL,
            cached_at       INTEGER DEFAULT (strftime('%s','now')),
            ttl_seconds     INTEGER DEFAULT 3600
        );

        -- ── Scan Log ────────────────────────────────────────────────────────
        -- Track library scan history
        CREATE TABLE IF NOT EXISTS scan_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      INTEGER DEFAULT (strftime('%s','now')),
            completed_at    INTEGER,
            files_found     INTEGER DEFAULT 0,
            files_added     INTEGER DEFAULT 0,
            files_updated   INTEGER DEFAULT 0,
            files_removed   INTEGER DEFAULT 0,
            status          TEXT DEFAULT 'running'
        );
        """)
        conn.commit()
        log.info("Database initialised at %s", DB_PATH)
    finally:
        conn.close()


def get_setting(key: str, default: str = None) -> str | None:
    """Read a setting from the database."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else default
    finally:
        conn.close()


def set_setting(key: str, value: str):
    """Write a setting to the database."""
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, strftime('%s','now'))
               ON CONFLICT(key) DO UPDATE SET
                 value = excluded.value,
                 updated_at = excluded.updated_at""",
            (key, value)
        )
        conn.commit()
    finally:
        conn.close()


def get_all_settings() -> dict:
    """Return all settings as a dict."""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}
    finally:
        conn.close()
