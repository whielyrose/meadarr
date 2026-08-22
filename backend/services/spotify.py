"""
Spotify API client for Meadarr.
Used for importing playlists by URL.
Uses Authorization Code flow — user pastes playlist URL, we fetch tracks.
No user login required for public playlists using Client Credentials.
Credentials stored in DB settings.
"""
import json
import time
import base64
import logging
import aiohttp
from database.models import get_setting, get_connection

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
    """Get a Client Credentials token (works for public playlists)."""
    global _token_cache

    # Return cached token if still valid
    if _token_cache.get("access_token") and _token_cache.get("expires_at", 0) > time.time() + 60:
        return _token_cache["access_token"]

    creds = _get_credentials()
    if not creds:
        log.error("Spotify credentials not configured")
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
                    return _token_cache["access_token"]
                else:
                    body = await resp.text()
                    log.error("Spotify token error %s: %s", resp.status, body[:200])
                    return None
    except Exception as e:
        log.error("Spotify token request failed: %s", e)
        return None


async def _spotify_get(path: str, params: dict = None) -> dict | None:
    token = await _get_token()
    if not token:
        return None

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{SPOTIFY_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 401:
                    # Token expired, clear cache and retry once
                    _token_cache.clear()
                    return None
                else:
                    body = await resp.text()
                    log.error("Spotify API %s returned %s: %s", path, resp.status, body[:200])
                    return None
    except Exception as e:
        log.error("Spotify API error: %s", e)
        return None


def extract_playlist_id(url_or_id: str) -> str | None:
    """
    Extract playlist ID from a Spotify URL or return the ID directly.
    Handles formats:
    - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
    - spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
    - 37i9dQZF1DXcBWIGoYBM5M
    """
    url = url_or_id.strip()

    if "open.spotify.com/playlist/" in url:
        # Extract ID from URL, handle query params
        part = url.split("open.spotify.com/playlist/")[1]
        return part.split("?")[0].split("/")[0]

    if url.startswith("spotify:playlist:"):
        return url.split("spotify:playlist:")[1]

    # Assume it's already an ID if it looks like one (alphanumeric, ~22 chars)
    if len(url) > 10 and url.isalnum():
        return url

    return None


async def get_playlist_info(playlist_id: str) -> dict | None:
    """Get basic info about a Spotify playlist."""
    data = await _spotify_get(f"/playlists/{playlist_id}", params={"fields": "id,name,description,tracks(total)"})
    if not data:
        return None
    return {
        "id": data["id"],
        "name": data["name"],
        "description": data.get("description", ""),
        "track_count": data.get("tracks", {}).get("total", 0),
    }


async def get_playlist_tracks(playlist_id: str, limit: int = 100) -> list[dict]:
    """
    Get all tracks from a Spotify playlist.
    Handles pagination for playlists > 100 tracks.
    Returns list of {artist, title, album, spotify_id}.
    """
    tracks = []
    offset = 0
    fields = "items(track(id,name,artists(name),album(name))),next"

    while True:
        data = await _spotify_get(
            f"/playlists/{playlist_id}/tracks",
            params={
                "fields": fields,
                "limit": min(limit, 100),
                "offset": offset,
            }
        )
        if not data:
            break

        items = data.get("items", [])
        for item in items:
            track = item.get("track")
            if not track:
                continue  # can be None for local files or unavailable tracks
            artists = track.get("artists", [{}])
            tracks.append({
                "spotify_id": track.get("id"),
                "title": track.get("name", ""),
                "artist": artists[0].get("name", "") if artists else "",
                "album": track.get("album", {}).get("name", ""),
            })

        # Check for next page
        if not data.get("next") or len(tracks) >= limit:
            break
        offset += 100

    log.info("Fetched %d tracks from Spotify playlist %s", len(tracks), playlist_id)
    return tracks


async def test_connection() -> bool:
    """Test Spotify credentials by fetching a token."""
    token = await _get_token()
    return token is not None
