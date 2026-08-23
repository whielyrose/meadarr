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


@router.get("/art")
async def get_album_art(artist: str, album: str, mbid: str = None):
    """
    Get album art URL for a given artist/album.
    Uses Last.fm as primary source, falls back to Cover Art Archive.
    Results are cached to avoid repeated API calls.
    Returns {url: string | null}
    """
    import time
    import aiohttp
    from database.models import get_connection, get_setting

    # Check cache first
    cache_key = f"art_{artist}_{album}".lower().replace(" ", "_")[:80]
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT result_json, cached_at FROM search_cache WHERE cache_key = ?",
            (f"albumart_{cache_key}",)
        ).fetchone()
        if row and (int(time.time()) - row["cached_at"]) < 86400 * 7:  # 7 day cache
            import json
            return json.loads(row["result_json"])
    finally:
        conn.close()

    art_url = None

    # Try Last.fm first (we have the API key configured)
    lastfm_key = get_setting("lastfm_api_key")
    if lastfm_key:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://ws.audioscrobbler.com/2.0/",
                    params={
                        "method": "album.getinfo",
                        "artist": artist,
                        "album": album,
                        "api_key": lastfm_key,
                        "format": "json",
                        "autocorrect": "1",
                    },
                    timeout=aiohttp.ClientTimeout(total=8),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        images = data.get("album", {}).get("image", [])
                        # Last.fm returns sizes: small, medium, large, extralarge, mega
                        for img in reversed(images):
                            url = img.get("#text", "")
                            if url and "2a96cbd8b46e442fc41c2b86b821562f" not in url:
                                # Skip the default "no image" hash
                                art_url = url
                                break
        except Exception as e:
            log.debug("Last.fm art fetch failed for %s - %s: %s", artist, album, e)

    # Fall back to Cover Art Archive if we have an MBID
    if not art_url and mbid:
        try:
            async with aiohttp.ClientSession() as session:
                # Fetch JSON listing first to get the actual image URL
                async with session.get(
                    f"https://coverartarchive.org/release-group/{mbid}",
                    headers={
                        "User-Agent": "Meadarr/1.0 (https://github.com/whielyrose/meadarr)",
                        "Accept": "application/json",
                    },
                    timeout=aiohttp.ClientTimeout(total=8),
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for img in data.get("images", []):
                            if img.get("front", False):
                                thumbs = img.get("thumbnails", {})
                                art_url = (
                                    thumbs.get("250") or
                                    thumbs.get("small") or
                                    thumbs.get("500") or
                                    img.get("image")
                                )
                                break
        except Exception as e:
            log.debug("CAA art fetch failed for %s: %s", mbid, e)

    result = {"url": art_url}

    # Cache the result
    import json
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO search_cache (cache_key, result_json, ttl_seconds)
               VALUES (?, ?, ?)
               ON CONFLICT(cache_key) DO UPDATE SET
                 result_json = excluded.result_json,
                 cached_at = strftime('%s','now'),
                 ttl_seconds = excluded.ttl_seconds""",
            (f"albumart_{cache_key}", json.dumps(result), 86400 * 7)
        )
        conn.commit()
    finally:
        conn.close()

    return result
