"""
Library API for Meadarr.
Browse and manage the indexed local music library.
"""
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Query
from database.models import get_connection
from services.library_scanner import (
    run_full_scan, get_library_stats, get_library_page
)
from services import jellyfin, notifier

log = logging.getLogger("meadarr.api.library")
router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("/stats")
async def get_stats():
    """Get library statistics."""
    return get_library_stats()


@router.get("/tracks")
async def get_tracks(
    q: str = Query(None, description="Search query"),
    artist: str = Query(None),
    album: str = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """Get paginated library tracks with optional filtering."""
    conn = get_connection()
    try:
        offset = (page - 1) * per_page
        where_clauses = []
        params = []

        if q:
            where_clauses.append(
                "(LOWER(artist) LIKE ? OR LOWER(album) LIKE ? OR LOWER(title) LIKE ?)"
            )
            term = f"%{q.lower()}%"
            params.extend([term, term, term])
        if artist:
            where_clauses.append("LOWER(artist) = LOWER(?)")
            params.append(artist)
        if album:
            where_clauses.append("LOWER(album) = LOWER(?)")
            params.append(album)

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


@router.get("/artists")
async def get_artists():
    """Get all artists in the library with track/album counts."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT
                artist,
                COUNT(DISTINCT LOWER(album)) as album_count,
                COUNT(*) as track_count,
                GROUP_CONCAT(DISTINCT format) as formats
               FROM library_tracks
               GROUP BY LOWER(artist)
               ORDER BY artist COLLATE NOCASE"""
        ).fetchall()
        return {"artists": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/artists/{artist}/albums")
async def get_artist_albums(artist: str):
    """Get all albums for a specific artist."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT
                album,
                year,
                COUNT(*) as track_count,
                format,
                release_mbid,
                MIN(track_number) as first_track
               FROM library_tracks
               WHERE LOWER(artist) = LOWER(?)
               GROUP BY LOWER(album)
               ORDER BY year, album""",
            (artist,)
        ).fetchall()
        if not rows:
            raise HTTPException(404, f"Artist not found: {artist}")
        return {"artist": artist, "albums": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/albums/{artist}/{album}")
async def get_album_tracks(artist: str, album: str):
    """Get all tracks for a specific album."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM library_tracks
               WHERE LOWER(artist) = LOWER(?) AND LOWER(album) = LOWER(?)
               ORDER BY disc_number, track_number""",
            (artist, album)
        ).fetchall()
        if not rows:
            raise HTTPException(404, "Album not found")
        return {
            "artist": artist,
            "album": album,
            "tracks": [dict(r) for r in rows],
        }
    finally:
        conn.close()


@router.post("/scan")
async def trigger_scan(background_tasks: BackgroundTasks):
    """Trigger a full library scan in the background."""
    async def _scan_and_notify():
        stats = await run_full_scan()
        if stats["files_added"] > 0 or stats["files_updated"] > 0:
            await notifier.notify_library_scan_complete(
                stats["files_added"], stats["files_updated"]
            )

    background_tasks.add_task(_scan_and_notify)
    return {"status": "scan started", "message": "Library scan running in background"}


@router.get("/scan/history")
async def get_scan_history(limit: int = 10):
    """Get recent scan history."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM scan_log ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return {"scans": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.delete("/tracks/{track_id}")
async def remove_track(track_id: int):
    """Remove a track from the library database (does not delete the file)."""
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM library_tracks WHERE id = ?", (track_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Track not found")
        conn.execute("DELETE FROM library_tracks WHERE id = ?", (track_id,))
        conn.commit()
        return {"status": "removed"}
    finally:
        conn.close()
