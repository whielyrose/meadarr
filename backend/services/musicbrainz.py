"""
MusicBrainz API client for Meadarr.
Rate limited to 1 req/s as per MusicBrainz policy.
Caches results in SQLite to avoid hammering the API.
"""
import json
import time
import logging
import asyncio
import aiohttp
from database.models import get_connection

log = logging.getLogger("meadarr.musicbrainz")

MB_BASE = "https://musicbrainz.org/ws/2"
HEADERS = {
    "User-Agent": "Meadarr/1.0 (self-hosted music manager)",
    "Accept": "application/json",
}
RATE_LIMIT = 1.1  # seconds between requests (slightly over 1 to be safe)
_last_request = 0.0


async def _rate_limited_get(url: str, params: dict = None) -> dict | None:
    """Make a rate-limited GET request to MusicBrainz."""
    global _last_request
    now = time.time()
    wait = RATE_LIMIT - (now - _last_request)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request = time.time()

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers=HEADERS,
                params=params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 503:
                    log.warning("MusicBrainz rate limited, waiting 5s")
                    await asyncio.sleep(5)
                    return None
                else:
                    log.error("MusicBrainz returned %s for %s", resp.status, url)
                    return None
    except Exception as e:
        log.error("MusicBrainz request error: %s", e)
        return None


def _cache_get(cache_key: str) -> dict | None:
    """Check cache for a result."""
    conn = get_connection()
    try:
        row = conn.execute(
            """SELECT result_json, cached_at, ttl_seconds
               FROM search_cache WHERE cache_key = ?""",
            (cache_key,)
        ).fetchone()
        if not row:
            return None
        age = int(time.time()) - row["cached_at"]
        if age > row["ttl_seconds"]:
            conn.execute("DELETE FROM search_cache WHERE cache_key = ?", (cache_key,))
            conn.commit()
            return None
        return json.loads(row["result_json"])
    finally:
        conn.close()


def _cache_set(cache_key: str, data: dict, ttl: int = 3600):
    """Store a result in cache."""
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO search_cache (cache_key, result_json, ttl_seconds)
               VALUES (?, ?, ?)
               ON CONFLICT(cache_key) DO UPDATE SET
                 result_json = excluded.result_json,
                 cached_at = strftime('%s','now'),
                 ttl_seconds = excluded.ttl_seconds""",
            (cache_key, json.dumps(data), ttl)
        )
        conn.commit()
    finally:
        conn.close()


async def search_releases(query: str, limit: int = 20) -> list[dict]:
    """
    Search MusicBrainz for releases (albums).
    Returns a list of release group dicts.
    """
    cache_key = f"mb_search_release_{query}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _rate_limited_get(
        f"{MB_BASE}/release-group",
        params={
            "query": query,
            "limit": limit,
            "fmt": "json",
        }
    )

    if not data:
        return []

    results = []
    for rg in data.get("release-groups", []):
        results.append({
            "mbid": rg.get("id"),
            "title": rg.get("title"),
            "type": rg.get("primary-type", "Album"),
            "artist": rg.get("artist-credit", [{}])[0].get("artist", {}).get("name", "Unknown") if rg.get("artist-credit") else "Unknown",
            "artist_mbid": rg.get("artist-credit", [{}])[0].get("artist", {}).get("id") if rg.get("artist-credit") else None,
            "year": rg.get("first-release-date", "")[:4] or None,
            "score": rg.get("score", 0),
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def search_artists(query: str, limit: int = 10) -> list[dict]:
    """Search MusicBrainz for artists."""
    cache_key = f"mb_search_artist_{query}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _rate_limited_get(
        f"{MB_BASE}/artist",
        params={
            "query": query,
            "limit": limit,
            "fmt": "json",
        }
    )

    if not data:
        return []

    results = []
    for artist in data.get("artists", []):
        results.append({
            "mbid": artist.get("id"),
            "name": artist.get("name"),
            "sort_name": artist.get("sort-name"),
            "type": artist.get("type"),
            "country": artist.get("country"),
            "disambiguation": artist.get("disambiguation"),
            "score": artist.get("score", 0),
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def get_artist_releases(artist_mbid: str) -> list[dict]:
    """Get all release groups for an artist."""
    cache_key = f"mb_artist_releases_{artist_mbid}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _rate_limited_get(
        f"{MB_BASE}/release-group",
        params={
            "artist": artist_mbid,
            "type": "album|ep|single",
            "limit": 100,
            "fmt": "json",
        }
    )

    if not data:
        return []

    results = []
    for rg in data.get("release-groups", []):
        results.append({
            "mbid": rg.get("id"),
            "title": rg.get("title"),
            "type": rg.get("primary-type", "Album"),
            "year": rg.get("first-release-date", "")[:4] or None,
        })

    results.sort(key=lambda x: x.get("year") or "0", reverse=True)
    _cache_set(cache_key, results, ttl=86400)  # cache for 24h
    return results


async def get_release_tracks(release_group_mbid: str) -> list[dict]:
    """
    Get tracks for a release group.
    Fetches the most popular release in the group.
    """
    cache_key = f"mb_release_tracks_{release_group_mbid}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    # First get releases in this group
    data = await _rate_limited_get(
        f"{MB_BASE}/release",
        params={
            "release-group": release_group_mbid,
            "limit": 5,
            "fmt": "json",
            "inc": "recordings",
        }
    )

    if not data or not data.get("releases"):
        return []

    # Pick the first release (usually the original)
    release = data["releases"][0]
    tracks = []

    for medium in release.get("media", []):
        for track in medium.get("tracks", []):
            recording = track.get("recording", {})
            tracks.append({
                "mbid": recording.get("id"),
                "title": track.get("title") or recording.get("title"),
                "track_number": track.get("position"),
                "disc_number": medium.get("position", 1),
                "duration_ms": recording.get("length"),
            })

    _cache_set(cache_key, tracks, ttl=86400)
    return tracks


async def get_recording(recording_mbid: str) -> dict | None:
    """Get details for a specific recording."""
    cache_key = f"mb_recording_{recording_mbid}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _rate_limited_get(
        f"{MB_BASE}/recording/{recording_mbid}",
        params={"fmt": "json", "inc": "artist-credits+releases"}
    )

    if not data:
        return None

    result = {
        "mbid": data.get("id"),
        "title": data.get("title"),
        "duration_ms": data.get("length"),
        "artist": data.get("artist-credit", [{}])[0].get("artist", {}).get("name") if data.get("artist-credit") else None,
    }

    _cache_set(cache_key, result, ttl=86400)
    return result
