"""
Spotify API client for Meadarr.
Uses Client Credentials flow — requires Client ID and Client Secret
from a free Spotify Developer account. No user login needed.
Works for any public playlist.
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
                    _token_cache.clear()
                    return None
                elif resp.status == 404:
                    log.error("Spotify playlist not found or is private")
                    return None
                else:
                    body = await resp.text()
                    log.error("Spotify API %s returned %s: %s", path, resp.status, body[:200])
                    return None
    except Exception as e:
        log.error("Spotify API error: %s", e)
        return None


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
    data = await _spotify_get(
        f"/playlists/{playlist_id}",
        params={"fields": "id,name,description,tracks(total)"}
    )
    if not data:
        return None
    return {
        "id": data["id"],
        "name": data.get("name", ""),
        "description": data.get("description", ""),
        "track_count": data.get("tracks", {}).get("total", 0),
    }


async def get_playlist_tracks(playlist_id: str) -> tuple[str, list[dict]]:
    """
    Get all tracks from a Spotify playlist.
    Returns (playlist_name, list of track dicts).
    Each track: {artist, title, album, spotify_id}
    """
    # First get playlist name
    info = await get_playlist_info(playlist_id)
    if not info:
        return "", []

    playlist_name = info["name"]
    tracks = []
    offset = 0
    fields = "items(track(id,name,artists(name),album(name))),next,total"

    while True:
        data = await _spotify_get(
            f"/playlists/{playlist_id}/tracks",
            params={
                "fields": fields,
                "limit": 100,
                "offset": offset,
            }
        )
        if not data:
            break

        items = data.get("items", [])
        for item in items:
            track = item.get("track")
            if not track:
                continue  # local files or unavailable tracks
            artists = track.get("artists", [{}])
            tracks.append({
                "spotify_id": track.get("id"),
                "title":      track.get("name", ""),
                "artist":     artists[0].get("name", "") if artists else "",
                "album":      track.get("album", {}).get("name", ""),
            })

        # Pagination
        if not data.get("next") or offset + 100 >= data.get("total", 0):
            break
        offset += 100

    log.info("Fetched %d tracks from Spotify playlist '%s'", len(tracks), playlist_name)
    return playlist_name, tracks


async def test_connection() -> bool:
    """Test Spotify credentials."""
    token = await _get_token()
    return token is not None
