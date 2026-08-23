"""
Deezer public API client for Meadarr.
Used to fetch 30-second preview snippets for album tracks.
No API key or authentication required — Deezer's public search endpoints
are free and don't require credentials.

Rate limit: 50 requests per 5 seconds.
"""
import logging
import aiohttp
import asyncio

log = logging.getLogger("meadarr.deezer")

BASE_URL = "https://api.deezer.com"
UA = "Meadarr/1.0"


async def _get(path: str, params: dict = None) -> dict | None:
    """Make an unauthenticated request to Deezer API."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{BASE_URL}{path}",
                params=params,
                headers={"User-Agent": UA, "Accept": "application/json"},
                timeout=aiohttp.ClientTimeout(total=8),
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 429:
                    log.warning("Deezer rate limit hit, backing off")
                    await asyncio.sleep(1)
                    return None
                else:
                    body = await resp.text()
                    log.debug("Deezer %s returned %d: %s", path, resp.status, body[:150])
                    return None
    except asyncio.TimeoutError:
        log.debug("Deezer request timed out: %s", path)
        return None
    except Exception as e:
        log.debug("Deezer request failed: %s", e)
        return None


async def find_album_id(artist: str, album: str) -> int | None:
    """
    Search Deezer for an album and return the album ID.
    Uses field-scoped query for accuracy.
    """
    # Try scoped search first: artist:"X" album:"Y"
    query = f'artist:"{artist}" album:"{album}"'
    data = await _get("/search/album", params={"q": query, "limit": 5})

    if not data or not data.get("data"):
        # Fallback: unscoped search
        data = await _get("/search/album", params={"q": f"{artist} {album}", "limit": 5})

    if not data or not data.get("data"):
        return None

    # Prefer exact matches
    artist_lower = artist.lower().strip()
    album_lower = album.lower().strip()

    for result in data.get("data", []):
        result_artist = result.get("artist", {}).get("name", "").lower().strip()
        result_album = result.get("title", "").lower().strip()

        # Exact match
        if result_artist == artist_lower and result_album == album_lower:
            return result.get("id")

    # Fuzzy match — first result if artist matches
    for result in data.get("data", []):
        result_artist = result.get("artist", {}).get("name", "").lower().strip()
        if artist_lower in result_artist or result_artist in artist_lower:
            return result.get("id")

    return None


async def get_album_tracks(album_id: int) -> list[dict]:
    """
    Get all tracks from a Deezer album with preview URLs.
    Returns list of {position, title, duration_ms, preview_url}.
    """
    data = await _get(f"/album/{album_id}")
    if not data:
        return []

    tracks = []
    for i, t in enumerate(data.get("tracks", {}).get("data", []), start=1):
        preview = t.get("preview", "")
        if not preview:
            continue  # skip tracks without previews

        tracks.append({
            "position":    t.get("track_position", i),
            "title":       t.get("title", ""),
            "duration_ms": (t.get("duration", 0) or 0) * 1000,
            "preview_url": preview,
        })

    return tracks


async def get_previews(artist: str, album: str) -> dict:
    """
    High-level: given an artist and album, return a dict with:
    - album_name: Deezer's normalized album name
    - cover_url: Deezer's album cover
    - tracks: [{position, title, duration_ms, preview_url}]

    Returns empty dict if nothing found.
    """
    album_id = await find_album_id(artist, album)
    if not album_id:
        return {}

    # Fetch album details
    data = await _get(f"/album/{album_id}")
    if not data:
        return {}

    tracks = []
    for i, t in enumerate(data.get("tracks", {}).get("data", []), start=1):
        preview = t.get("preview", "")
        tracks.append({
            "position":    t.get("track_position", i),
            "title":       t.get("title", ""),
            "duration_ms": (t.get("duration", 0) or 0) * 1000,
            "preview_url": preview,  # may be empty for some tracks
        })

    return {
        "album_id":   album_id,
        "album_name": data.get("title", album),
        "artist":     data.get("artist", {}).get("name", artist),
        "cover_url":  data.get("cover_medium") or data.get("cover"),
        "tracks":     tracks,
    }
