"""
Spotify API client for Meadarr.
Uses Client Credentials flow — requires Client ID and Secret.
Works for any public playlist owned by users (not Spotify-owned playlists).

NOTE: As of March 2026, Spotify renamed the playlist tracks endpoint:
  OLD: GET /v1/playlists/{id}/tracks  (returns 403 for dev mode apps)
  NEW: GET /v1/playlists/{id}/items   (current endpoint)
  Field rename: tracks.track -> items.item
"""
import json
import time
import base64
import re
import logging
import aiohttp
from database.models import get_setting

log = logging.getLogger("meadarr.spotify")

SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE  = "https://api.spotify.com/v1"

_token_cache: dict = {}


def _get_credentials() -> tuple[str, str] | None:
    client_id     = get_setting("spotify_client_id")
    client_secret = get_setting("spotify_client_secret")
    if not client_id or not client_secret:
        return None
    return client_id, client_secret


async def _get_token() -> str | None:
    """Get a Client Credentials token. No user login needed."""
    global _token_cache

    if _token_cache.get("access_token") and _token_cache.get("expires_at", 0) > time.time() + 60:
        return _token_cache["access_token"]

    creds = _get_credentials()
    if not creds:
        log.error("Spotify Client ID and Secret not configured")
        return None

    client_id, client_secret = creds
    auth = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                SPOTIFY_TOKEN_URL,
                headers={
                    "Authorization": f"Basic {auth}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials"},
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    _token_cache = {
                        "access_token": data["access_token"],
                        "expires_at": time.time() + data.get("expires_in", 3600),
                    }
                    log.info("Spotify token obtained successfully")
                    return _token_cache["access_token"]
                else:
                    body = await resp.text()
                    log.error("Spotify token error %s: %s", resp.status, body[:200])
                    return None
    except Exception as e:
        log.error("Spotify token request failed: %s", e)
        return None


async def _spotify_get(path: str, params: dict = None) -> tuple[dict | None, int]:
    """
    Make a Spotify API request.
    Returns (data, status_code) so callers can handle specific errors.
    """
    token = await _get_token()
    if not token:
        return None, 401

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{SPOTIFY_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                status = resp.status
                if status == 200:
                    return await resp.json(), 200
                elif status == 401:
                    _token_cache.clear()
                    log.error("Spotify token expired or invalid")
                    return None, 401
                elif status == 403:
                    body = await resp.text()
                    log.error("Spotify 403 Forbidden for %s: %s", path, body[:200])
                    return None, 403
                elif status == 404:
                    log.error("Spotify 404 for %s — playlist not found or Spotify-owned", path)
                    return None, 404
                else:
                    body = await resp.text()
                    log.error("Spotify API %s returned %s: %s", path, status, body[:200])
                    return None, status
    except Exception as e:
        log.error("Spotify API error: %s", e)
        return None, 0


def extract_playlist_id(url_or_id: str) -> str | None:
    """Extract playlist ID from URL, URI, or raw ID."""
    url = url_or_id.strip()

    if "open.spotify.com/playlist/" in url:
        part = url.split("open.spotify.com/playlist/")[1]
        return part.split("?")[0].split("/")[0]

    if url.startswith("spotify:playlist:"):
        return url.split("spotify:playlist:")[1]

    if re.match(r'^[A-Za-z0-9]{10,}$', url):
        return url

    return None


async def get_playlist_info(playlist_id: str) -> dict | None:
    """Get basic info about a Spotify playlist."""
    data, status = await _spotify_get(
        f"/playlists/{playlist_id}",
        params={"fields": "id,name,description,tracks(total),owner(id,display_name)"}
    )
    if not data:
        return None
    return {
        "id": data["id"],
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "track_count": data.get("tracks", {}).get("total", 0),
        "owner": data.get("owner", {}).get("display_name", ""),
    }


async def get_playlist_tracks(playlist_id: str) -> tuple[str, list[dict]]:
    """
    Get all tracks from a Spotify playlist.
    Returns (playlist_name, list of track dicts).

    Uses the current /items endpoint (renamed from /tracks in March 2026).
    Falls back to /tracks endpoint for older compatibility.
    """
    # First get playlist name
    info_data, info_status = await _spotify_get(f"/playlists/{playlist_id}")
    if not info_data:
        if info_status == 404:
            log.error("Playlist %s not found — may be private or Spotify-owned", playlist_id)
        return "", []

    playlist_name = info_data.get("name", "")
    tracks = []
    offset = 0

    # Try the new /items endpoint first (post-March 2026)
    # Then fall back to /tracks if needed
    for endpoint_suffix in ["/items", "/tracks"]:
        tracks = []
        offset = 0
        success = True

        while True:
            data, status = await _spotify_get(
                f"/playlists/{playlist_id}{endpoint_suffix}",
                params={
                    "limit": 100,
                    "offset": offset,
                    "additional_types": "track",
                }
            )

            if status == 403:
                log.warning("Endpoint %s returned 403, trying fallback...", endpoint_suffix)
                success = False
                break

            if not data:
                success = False
                break

            # Handle both /items (new) and /tracks (old) response formats
            items = data.get("items", [])
            total = data.get("total", 0)

            for item in items:
                # New /items format: item.track field
                # Old /tracks format: item.track field (same!)
                track = item.get("track") or item.get("item")
                if not track or track.get("type") != "track":
                    continue  # skip episodes, local files etc
                artists = track.get("artists", [{}])
                tracks.append({
                    "spotify_id": track.get("id"),
                    "title":      track.get("name", ""),
                    "artist":     artists[0].get("name", "") if artists else "",
                    "album":      track.get("album", {}).get("name", ""),
                })

            # Pagination
            if not data.get("next") or offset + 100 >= total:
                break
            offset += 100

        if success and tracks:
            log.info("Fetched %d tracks from Spotify playlist '%s' via %s",
                     len(tracks), playlist_name, endpoint_suffix)
            return playlist_name, tracks

        if success and not tracks:
            # Got a response but empty — genuinely empty playlist
            log.info("Playlist '%s' is empty", playlist_name)
            return playlist_name, []

    # Both endpoints failed
    log.error("Could not fetch tracks from Spotify playlist %s (tried /items and /tracks)",
              playlist_id)
    return playlist_name, []


async def test_connection() -> bool:
    """Test Spotify credentials by getting a token."""
    token = await _get_token()
    if not token:
        return False
    # Test with a simple API call
    data, status = await _spotify_get("/browse/featured-playlists", params={"limit": 1})
    # 200 = works, 403 = token valid but endpoint restricted (still means auth works)
    return status in (200, 403)
