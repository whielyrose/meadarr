"""
Last.fm API client for Meadarr.
Used for music discovery and recommendations.
API key stored in DB settings, not env vars.
"""
import json
import time
import logging
import aiohttp
from database.models import get_connection, get_setting

log = logging.getLogger("meadarr.lastfm")

LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"


def _cache_get(cache_key: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT result_json, cached_at, ttl_seconds FROM search_cache WHERE cache_key = ?",
            (cache_key,)
        ).fetchone()
        if not row:
            return None
        if int(time.time()) - row["cached_at"] > row["ttl_seconds"]:
            conn.execute("DELETE FROM search_cache WHERE cache_key = ?", (cache_key,))
            conn.commit()
            return None
        return json.loads(row["result_json"])
    finally:
        conn.close()


def _cache_set(cache_key: str, data, ttl: int = 3600):
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


async def _lastfm_get(method: str, params: dict = None) -> dict | None:
    """Make a Last.fm API request."""
    api_key = get_setting("lastfm_api_key")
    if not api_key:
        log.warning("Last.fm API key not configured")
        return None

    request_params = {
        "method": method,
        "api_key": api_key,
        "format": "json",
        **(params or {})
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                LASTFM_BASE,
                params=request_params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if "error" in data:
                        log.error("Last.fm error %s: %s", data["error"], data.get("message"))
                        return None
                    return data
                else:
                    log.error("Last.fm returned %s", resp.status)
                    return None
    except Exception as e:
        log.error("Last.fm request error: %s", e)
        return None


async def get_similar_artists(artist: str, limit: int = 10) -> list[dict]:
    """Get similar artists from Last.fm."""
    cache_key = f"lastfm_similar_{artist}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lastfm_get("artist.getSimilar", {
        "artist": artist,
        "limit": limit,
        "autocorrect": 1,
    })

    if not data:
        return []

    results = []
    for a in data.get("similarartists", {}).get("artist", []):
        results.append({
            "name": a.get("name"),
            "match": float(a.get("match", 0)),
            "url": a.get("url"),
            "image": next(
                (img["#text"] for img in reversed(a.get("image", []))
                 if img.get("#text")),
                None
            ),
        })

    _cache_set(cache_key, results, ttl=86400)
    return results


async def get_top_albums(artist: str, limit: int = 10) -> list[dict]:
    """Get top albums for an artist from Last.fm."""
    cache_key = f"lastfm_top_albums_{artist}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lastfm_get("artist.getTopAlbums", {
        "artist": artist,
        "limit": limit,
        "autocorrect": 1,
    })

    if not data:
        return []

    results = []
    for album in data.get("topalbums", {}).get("album", []):
        results.append({
            "name": album.get("name"),
            "artist": album.get("artist", {}).get("name"),
            "playcount": int(album.get("playcount", 0)),
            "url": album.get("url"),
            "image": next(
                (img["#text"] for img in reversed(album.get("image", []))
                 if img.get("#text")),
                None
            ),
        })

    _cache_set(cache_key, results, ttl=86400)
    return results


async def get_user_top_artists(limit: int = 20, period: str = "overall") -> list[dict]:
    """
    Get user's top artists from Last.fm.
    period: overall | 7day | 1month | 3month | 6month | 12month
    """
    username = get_setting("lastfm_username")
    if not username:
        log.warning("Last.fm username not configured")
        return []

    cache_key = f"lastfm_top_artists_{username}_{period}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lastfm_get("user.getTopArtists", {
        "user": username,
        "limit": limit,
        "period": period,
    })

    if not data:
        return []

    results = []
    for artist in data.get("topartists", {}).get("artist", []):
        results.append({
            "name": artist.get("name"),
            "playcount": int(artist.get("playcount", 0)),
            "rank": int(artist.get("@attr", {}).get("rank", 0)),
            "url": artist.get("url"),
            "image": next(
                (img["#text"] for img in reversed(artist.get("image", []))
                 if img.get("#text")),
                None
            ),
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def get_user_top_albums(limit: int = 20, period: str = "overall") -> list[dict]:
    """Get user's top albums from Last.fm."""
    username = get_setting("lastfm_username")
    if not username:
        return []

    cache_key = f"lastfm_top_albums_user_{username}_{period}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lastfm_get("user.getTopAlbums", {
        "user": username,
        "limit": limit,
        "period": period,
    })

    if not data:
        return []

    results = []
    for album in data.get("topalbums", {}).get("album", []):
        results.append({
            "name": album.get("name"),
            "artist": album.get("artist", {}).get("name"),
            "playcount": int(album.get("playcount", 0)),
            "rank": int(album.get("@attr", {}).get("rank", 0)),
            "url": album.get("url"),
            "image": next(
                (img["#text"] for img in reversed(album.get("image", []))
                 if img.get("#text")),
                None
            ),
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def get_recommended_artists(limit: int = 20) -> list[dict]:
    """
    Build recommendations from user's top artists + their similar artists.
    Excludes artists already in the user's top list.
    """
    top_artists = await get_user_top_artists(limit=10)
    if not top_artists:
        return []

    top_names = {a["name"].lower() for a in top_artists}
    recommendations = {}

    for artist in top_artists[:5]:  # only expand top 5 to avoid too many API calls
        similar = await get_similar_artists(artist["name"], limit=5)
        for s in similar:
            name = s["name"]
            if name.lower() not in top_names and name not in recommendations:
                recommendations[name] = {
                    **s,
                    "reason": f"Similar to {artist['name']}",
                }

    results = sorted(recommendations.values(), key=lambda x: x["match"], reverse=True)
    return results[:limit]


async def get_new_releases_for_top_artists() -> list[dict]:
    """Get Last.fm info for top artists to cross-reference with MusicBrainz."""
    top_artists = await get_user_top_artists(limit=20)
    return top_artists


async def test_connection() -> bool:
    """Test Last.fm API key is valid."""
    api_key = get_setting("lastfm_api_key")
    if not api_key:
        return False
    data = await _lastfm_get("chart.getTopArtists", {"limit": 1})
    return data is not None
