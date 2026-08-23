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
    Tries multiple sources in parallel for fastest response:
    1. Cover Art Archive (via MBID)
    2. Last.fm
    3. iTunes Search API (fallback, no key needed)
    Cached in SQLite for 30 days.
    """
    import time
    import asyncio
    import json
    import aiohttp
    from database.models import get_connection, get_setting

    # Cache key
    def _norm(s: str) -> str:
        return "".join(c for c in s.lower() if c.isalnum() or c in " -")

    cache_key = f"albumart_{_norm(artist)}_{_norm(album)}"[:180]

    # Check cache
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT result_json, cached_at FROM search_cache WHERE cache_key = ?",
            (cache_key,)
        ).fetchone()
        if row and (int(time.time()) - row["cached_at"]) < 86400 * 30:
            cached = json.loads(row["result_json"])
            if cached.get("url"):
                return cached
    finally:
        conn.close()

    # Try multiple sources in parallel
    lastfm_key = get_setting("lastfm_api_key")

    async def try_lastfm() -> str | None:
        if not lastfm_key:
            return None
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
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    images = data.get("album", {}).get("image", [])
                    for img in reversed(images):
                        url = img.get("#text", "")
                        # Skip default placeholder
                        if url and "2a96cbd8b46e442fc41c2b86b821562f" not in url:
                            return url
        except Exception as e:
            log.debug("Last.fm art failed: %s", e)
        return None

    async def try_caa() -> str | None:
        if not mbid:
            return None
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"https://coverartarchive.org/release-group/{mbid}",
                    headers={
                        "User-Agent": "Meadarr/1.0 (https://github.com/whielyrose/meadarr)",
                        "Accept": "application/json",
                    },
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    for img in data.get("images", []):
                        if img.get("front", False):
                            thumbs = img.get("thumbnails", {})
                            return (
                                thumbs.get("500") or
                                thumbs.get("large") or
                                thumbs.get("250") or
                                thumbs.get("small") or
                                img.get("image")
                            )
        except Exception as e:
            log.debug("CAA art failed: %s", e)
        return None

    async def try_itunes() -> str | None:
        """iTunes Search API — no key needed."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://itunes.apple.com/search",
                    params={
                        "term": f"{artist} {album}",
                        "entity": "album",
                        "limit": 1,
                    },
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                    results = data.get("results", [])
                    if results:
                        # iTunes returns 100x100 by default; upgrade to 500x500
                        art = results[0].get("artworkUrl100", "")
                        if art:
                            return art.replace("100x100", "500x500")
        except Exception as e:
            log.debug("iTunes art failed: %s", e)
        return None

    # Race all sources - first non-None wins
    tasks = [try_caa(), try_lastfm(), try_itunes()]
    art_url = None

    # Use asyncio.wait to get results as they come in
    done, pending = await asyncio.wait(
        [asyncio.create_task(t) for t in tasks],
        return_when=asyncio.FIRST_COMPLETED,
        timeout=6.0,
    )

    # Check results in order of preference
    results = {}
    for task in done:
        try:
            result = task.result()
            if result:
                results[str(task.get_coro())] = result
        except Exception:
            pass

    # Wait a bit more for other sources to see if they respond
    if not results and pending:
        more_done, still_pending = await asyncio.wait(pending, timeout=3.0)
        for task in more_done:
            try:
                result = task.result()
                if result:
                    results[str(task.get_coro())] = result
            except Exception:
                pass
        # Cancel any still pending
        for task in still_pending:
            task.cancel()
    else:
        for task in pending:
            task.cancel()

    # Pick first available
    art_url = next(iter(results.values()), None) if results else None

    # Cache result (even if None, to avoid retrying failed lookups)
    result = {"url": art_url}
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO search_cache (cache_key, result_json, ttl_seconds)
               VALUES (?, ?, ?)
               ON CONFLICT(cache_key) DO UPDATE SET
                 result_json = excluded.result_json,
                 cached_at = strftime('%s','now'),
                 ttl_seconds = excluded.ttl_seconds""",
            (cache_key, json.dumps(result), 86400 * 30)
        )
        conn.commit()
    finally:
        conn.close()

    return result
