"""
ListenBrainz API client for Meadarr.
Used for music discovery and recommendations when Last.fm history is limited.
API token stored in DB settings.
"""
import json
import time
import logging
import aiohttp
from database.models import get_connection, get_setting

log = logging.getLogger("meadarr.listenbrainz")

LB_BASE = "https://api.listenbrainz.org/1"


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


async def _lb_request(path: str, params: dict = None, auth: bool = True) -> dict | None:
    """Make a ListenBrainz API request."""
    token = get_setting("listenbrainz_token")
    headers = {"Accept": "application/json"}
    if auth and token:
        headers["Authorization"] = f"Token {token}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{LB_BASE}{path}",
                headers=headers,
                params=params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 401:
                    log.error("ListenBrainz: Unauthorized — check API token")
                    return None
                else:
                    log.error("ListenBrainz returned %s for %s", resp.status, path)
                    return None
    except Exception as e:
        log.error("ListenBrainz request error: %s", e)
        return None


async def get_top_artists(limit: int = 20, period: str = "all_time") -> list[dict]:
    """
    Get user's top artists from ListenBrainz.
    period: all_time | year | month | week
    """
    username = get_setting("listenbrainz_username")
    if not username:
        return []

    cache_key = f"lb_top_artists_{username}_{period}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lb_request(
        f"/stats/user/{username}/artists",
        params={"range": period, "count": limit}
    )

    if not data or not data.get("payload"):
        return []

    results = []
    for artist in data["payload"].get("artists", []):
        results.append({
            "name": artist.get("artist_name"),
            "msid": artist.get("artist_msid"),
            "mbid": artist.get("artist_mbid"),
            "listen_count": artist.get("listen_count", 0),
            "rank": artist.get("rank", 0),
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def get_top_albums(limit: int = 20, period: str = "all_time") -> list[dict]:
    """Get user's top releases from ListenBrainz."""
    username = get_setting("listenbrainz_username")
    if not username:
        return []

    cache_key = f"lb_top_releases_{username}_{period}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lb_request(
        f"/stats/user/{username}/releases",
        params={"range": period, "count": limit}
    )

    if not data or not data.get("payload"):
        return []

    results = []
    for release in data["payload"].get("releases", []):
        results.append({
            "name": release.get("release_name"),
            "artist": release.get("artist_name"),
            "mbid": release.get("release_mbid"),
            "listen_count": release.get("listen_count", 0),
            "rank": release.get("rank", 0),
            "in_library": False,
            "library_quality": None,
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def get_similar_artists(artist_mbid: str, limit: int = 10) -> list[dict]:
    """Get similar artists using MusicBrainz ID."""
    if not artist_mbid:
        return []

    cache_key = f"lb_similar_{artist_mbid}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lb_request(
        f"/similarity/artist/{artist_mbid}/artist",
        params={"algorithm": "session_based_days_7500_session_50_contribution_5_threshold_10_limit_100_filter_True_skip_False"},
        auth=False
    )

    if not data:
        return []

    results = []
    for artist in (data if isinstance(data, list) else data.get("artists", []))[:limit]:
        results.append({
            "name": artist.get("name") or artist.get("artist_name"),
            "mbid": artist.get("artist_mbid") or artist.get("mbid"),
            "similarity": artist.get("score", 0),
        })

    _cache_set(cache_key, results, ttl=86400)
    return results


async def get_recommendations(limit: int = 25) -> list[dict]:
    """
    Get personalised track recommendations from ListenBrainz.
    Requires API token.
    """
    username = get_setting("listenbrainz_username")
    if not username:
        return []

    cache_key = f"lb_recommendations_{username}_{limit}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    data = await _lb_request(
        f"/cf/recommendation/user/{username}/recording",
        params={"count": limit, "artist_type": "top"}
    )

    if not data or not data.get("payload"):
        return []

    results = []
    for rec in data["payload"].get("mbids", [])[:limit]:
        results.append({
            "recording_mbid": rec.get("recording_mbid"),
            "score": rec.get("score", 0),
        })

    _cache_set(cache_key, results, ttl=3600)
    return results


async def get_recommended_artists(limit: int = 20) -> list[dict]:
    """
    Build artist recommendations from user's top artists + similar artists.
    Falls back gracefully if no data available.
    """
    top_artists = await get_top_artists(limit=10)
    if not top_artists:
        return []

    top_names = {a["name"].lower() for a in top_artists if a.get("name")}
    recommendations = {}

    for artist in top_artists[:5]:
        mbid = artist.get("mbid")
        if not mbid:
            continue
        similar = await get_similar_artists(mbid, limit=5)
        for s in similar:
            name = s.get("name", "")
            if name and name.lower() not in top_names and name not in recommendations:
                recommendations[name] = {
                    **s,
                    "reason": f"Similar to {artist['name']}",
                    "listen_count": artist.get("listen_count", 0),
                }

    results = sorted(
        recommendations.values(),
        key=lambda x: x.get("similarity", 0),
        reverse=True
    )
    return results[:limit]


async def test_connection() -> bool:
    """Test ListenBrainz connection."""
    username = get_setting("listenbrainz_username")
    token = get_setting("listenbrainz_token")
    if not username or not token:
        return False
    data = await _lb_request(f"/user/{username}/listen-count")
    return data is not None
