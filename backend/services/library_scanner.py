"""
Library scanner for Meadarr.
Walks the music library, reads tags, and maintains the SQLite
library_tracks table for deduplication.
"""
import time
import logging
from pathlib import Path
from database.models import get_connection
from services.tagger import scan_music_library

log = logging.getLogger("meadarr.scanner")


def track_exists(artist: str, album: str, title: str, mbid: str = None) -> bool:
    """
    Check if a track already exists in the library.
    Uses MusicBrainz ID if available, otherwise fuzzy artist+album+title match.
    Returns True if track is already in library.
    """
    conn = get_connection()
    try:
        # Check by MBID first (most reliable)
        if mbid:
            row = conn.execute(
                "SELECT id FROM library_tracks WHERE mbid = ?", (mbid,)
            ).fetchone()
            if row:
                return True

        # Fuzzy match by artist + title (case insensitive)
        row = conn.execute(
            """SELECT id FROM library_tracks
               WHERE LOWER(artist) = LOWER(?)
               AND LOWER(title) = LOWER(?)
               AND LOWER(album) = LOWER(?)""",
            (artist, title, album)
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def album_exists(artist: str, album: str, mbid: str = None) -> bool:
    """
    Check if an entire album already exists in the library.
    Returns True if we have at least one track from this album.
    """
    conn = get_connection()
    try:
        if mbid:
            row = conn.execute(
                "SELECT id FROM library_tracks WHERE release_mbid = ? LIMIT 1", (mbid,)
            ).fetchone()
            if row:
                return True

        row = conn.execute(
            """SELECT id FROM library_tracks
               WHERE LOWER(artist) = LOWER(?)
               AND LOWER(album) = LOWER(?)
               LIMIT 1""",
            (artist, album)
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def get_album_quality(artist: str, album: str) -> str | None:
    """
    Get the format/quality of an existing album in the library.
    Returns 'mp3', 'flac', or None if not found.
    """
    conn = get_connection()
    try:
        row = conn.execute(
            """SELECT format FROM library_tracks
               WHERE LOWER(artist) = LOWER(?)
               AND LOWER(album) = LOWER(?)
               LIMIT 1""",
            (artist, album)
        ).fetchone()
        return row["format"] if row else None
    finally:
        conn.close()


def add_track_to_library(track_data: dict) -> int | None:
    """
    Add or update a track in the library database.
    Returns the row ID.
    """
    conn = get_connection()
    try:
        # Check if file path already exists (update) or new track (insert)
        existing = conn.execute(
            "SELECT id FROM library_tracks WHERE file_path = ?",
            (track_data.get("file_path"),)
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE library_tracks SET
                   mbid = ?, release_mbid = ?, artist = ?, album = ?,
                   title = ?, year = ?, track_number = ?, disc_number = ?,
                   duration_ms = ?, format = ?, bitrate = ?, file_size = ?,
                   scanned_at = ?
                   WHERE file_path = ?""",
                (
                    track_data.get("mbid"),
                    track_data.get("release_mbid"),
                    track_data.get("artist", "Unknown"),
                    track_data.get("album", "Unknown"),
                    track_data.get("title", "Unknown"),
                    track_data.get("year"),
                    track_data.get("track_number"),
                    track_data.get("disc_number", 1),
                    track_data.get("duration_ms"),
                    track_data.get("format"),
                    track_data.get("bitrate"),
                    track_data.get("file_size"),
                    int(time.time()),
                    track_data.get("file_path"),
                )
            )
            conn.commit()
            return existing["id"]
        else:
            cursor = conn.execute(
                """INSERT INTO library_tracks
                   (mbid, release_mbid, artist, album, title, year,
                    track_number, disc_number, duration_ms, format,
                    bitrate, file_path, file_size, scanned_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    track_data.get("mbid"),
                    track_data.get("release_mbid"),
                    track_data.get("artist", "Unknown"),
                    track_data.get("album", "Unknown"),
                    track_data.get("title", "Unknown"),
                    track_data.get("year"),
                    track_data.get("track_number"),
                    track_data.get("disc_number", 1),
                    track_data.get("duration_ms"),
                    track_data.get("format"),
                    track_data.get("bitrate"),
                    track_data.get("file_path"),
                    track_data.get("file_size"),
                    int(time.time()),
                )
            )
            conn.commit()
            return cursor.lastrowid
    except Exception as e:
        log.error("Failed to add track to library: %s", e)
        conn.rollback()
        return None
    finally:
        conn.close()


def remove_missing_tracks():
    """Remove tracks from DB that no longer exist on disk."""
    conn = get_connection()
    try:
        rows = conn.execute("SELECT id, file_path FROM library_tracks").fetchall()
        removed = 0
        for row in rows:
            if not Path(row["file_path"]).exists():
                conn.execute("DELETE FROM library_tracks WHERE id = ?", (row["id"],))
                removed += 1
        conn.commit()
        if removed:
            log.info("Removed %d missing tracks from library DB", removed)
        return removed
    finally:
        conn.close()


def get_library_stats() -> dict:
    """Get library statistics."""
    conn = get_connection()
    try:
        total = conn.execute("SELECT COUNT(*) FROM library_tracks").fetchone()[0]
        artists = conn.execute("SELECT COUNT(DISTINCT LOWER(artist)) FROM library_tracks").fetchone()[0]
        albums = conn.execute("SELECT COUNT(DISTINCT LOWER(artist) || '|' || LOWER(album)) FROM library_tracks").fetchone()[0]
        formats = conn.execute(
            "SELECT format, COUNT(*) as count FROM library_tracks GROUP BY format"
        ).fetchall()
        total_size = conn.execute("SELECT SUM(file_size) FROM library_tracks").fetchone()[0] or 0

        return {
            "total_tracks": total,
            "total_artists": artists,
            "total_albums": albums,
            "formats": {r["format"]: r["count"] for r in formats},
            "total_size_gb": round(total_size / 1_073_741_824, 2),
        }
    finally:
        conn.close()


def get_library_page(page: int = 1, per_page: int = 50,
                     search: str = None, artist: str = None) -> dict:
    """Get paginated library tracks."""
    conn = get_connection()
    try:
        offset = (page - 1) * per_page
        where_clauses = []
        params = []

        if search:
            where_clauses.append(
                "(LOWER(artist) LIKE ? OR LOWER(album) LIKE ? OR LOWER(title) LIKE ?)"
            )
            term = f"%{search.lower()}%"
            params.extend([term, term, term])

        if artist:
            where_clauses.append("LOWER(artist) = LOWER(?)")
            params.append(artist)

        where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        total = conn.execute(
            f"SELECT COUNT(*) FROM library_tracks {where}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"""SELECT * FROM library_tracks {where}
                ORDER BY artist, album, disc_number, track_number
                LIMIT ? OFFSET ?""",
            [*params, per_page, offset]
        ).fetchall()

        return {
            "total": total,
            "page": page,
            "per_page": per_page,
            "tracks": [dict(r) for r in rows],
        }
    finally:
        conn.close()


async def run_full_scan() -> dict:
    """
    Run a full library scan.
    Walks all files, reads tags, updates DB.
    Returns scan stats.
    """
    conn = get_connection()
    scan_id = None
    try:
        # Record scan start
        cursor = conn.execute(
            "INSERT INTO scan_log (started_at) VALUES (strftime('%s','now'))"
        )
        scan_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    log.info("Starting library scan...")
    files = scan_music_library()

    added = 0
    updated = 0

    for file_data in files:
        conn = get_connection()
        try:
            existing = conn.execute(
                "SELECT id FROM library_tracks WHERE file_path = ?",
                (file_data.get("file_path"),)
            ).fetchone()
        finally:
            conn.close()

        result = add_track_to_library(file_data)
        if result:
            if existing:
                updated += 1
            else:
                added += 1

    removed = remove_missing_tracks()

    # Update scan log
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE scan_log SET
               completed_at = strftime('%s','now'),
               files_found = ?,
               files_added = ?,
               files_updated = ?,
               files_removed = ?,
               status = 'completed'
               WHERE id = ?""",
            (len(files), added, updated, removed, scan_id)
        )
        conn.commit()
    finally:
        conn.close()

    stats = {
        "files_found": len(files),
        "files_added": added,
        "files_updated": updated,
        "files_removed": removed,
    }
    log.info("Library scan complete: %s", stats)
    return stats
