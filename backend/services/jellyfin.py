"""
Jellyfin API client for Meadarr.
Handles library scanning, playlist creation, and track lookup.
All credentials read from DB settings.

IMPORTANT: Jellyfin playlist endpoints require a userId when using API key auth.
We fetch the admin user ID on first use and cache it.
"""
import logging
import aiohttp
from database.models import get_setting

log = logging.getLogger("meadarr.jellyfin")

_cached_user_id: str | None = None


def _get_config() -> tuple[str, str] | None:
    url = get_setting("jellyfin_url")
    api_key = get_setting("jellyfin_api_key")
    if not url or not api_key:
        return None
    return url.rstrip("/"), api_key


async def _jf_request(method: str, path: str, json_data: dict = None,
                       params: dict = None) -> dict | list | None:
    config = _get_config()
    if not config:
        log.error("Jellyfin not configured")
        return None
    url, api_key = config

    headers = {
        "X-Emby-Token": api_key,
        "Content-Type": "application/json",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method,
                f"{url}{path}",
                headers=headers,
                json=json_data,
                params=params,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status in (200, 201):
                    try:
                        return await resp.json()
                    except Exception:
                        return {"status": "ok"}
                elif resp.status == 204:
                    return {"status": "ok"}
                else:
                    body = await resp.text()
                    log.error("Jellyfin %s %s returned %s: %s",
                              method, path, resp.status, body[:200])
                    return None
    except Exception as e:
        log.error("Jellyfin request error: %s", e)
        return None


async def _get_user_id() -> str | None:
    """
    Get the first admin user ID.
    Jellyfin playlist API requires userId when using API key auth.
    """
    global _cached_user_id
    if _cached_user_id:
        return _cached_user_id

    data = await _jf_request("GET", "/Users")
    if not data or not isinstance(data, list):
        return None

    # Prefer admin user
    for user in data:
        if user.get("Policy", {}).get("IsAdministrator", False):
            _cached_user_id = user["Id"]
            return _cached_user_id

    # Fall back to first user
    if data:
        _cached_user_id = data[0]["Id"]
        return _cached_user_id

    return None


async def get_music_libraries() -> list[dict]:
    data = await _jf_request("GET", "/Library/VirtualFolders")
    if not data:
        return []
    return [
        {"id": lib["ItemId"], "name": lib["Name"]}
        for lib in (data if isinstance(data, list) else [])
        if lib.get("CollectionType", "").lower() == "music"
    ]


async def scan_library(library_id: str = None):
    if library_id:
        await _jf_request(
            "POST",
            f"/Items/{library_id}/Refresh",
            params={
                "Recursive": "true",
                "ImageRefreshMode": "Default",
                "MetadataRefreshMode": "Default",
                "ReplaceAllImages": "false",
                "ReplaceAllMetadata": "false",
            }
        )
        log.info("Triggered Jellyfin scan for library %s", library_id)
    else:
        libs = await get_music_libraries()
        for lib in libs:
            await _jf_request(
                "POST",
                f"/Items/{lib['id']}/Refresh",
                params={
                    "Recursive": "true",
                    "ImageRefreshMode": "Default",
                    "MetadataRefreshMode": "Default",
                    "ReplaceAllImages": "false",
                    "ReplaceAllMetadata": "false",
                }
            )
        log.info("Triggered Jellyfin scan for %d music libraries", len(libs))


async def find_track(artist: str, album: str, title: str) -> dict | None:
    data = await _jf_request(
        "GET", "/Items",
        params={
            "IncludeItemTypes": "Audio",
            "SearchTerm": title,
            "Recursive": "true",
            "Fields": "ParentId,AlbumArtist,Album,Path",
            "Limit": 10,
        }
    )
    if not data or not data.get("Items"):
        return None

    for item in data["Items"]:
        item_artist = item.get("AlbumArtist", "").lower()
        item_title = item.get("Name", "").lower()
        if (artist.lower() in item_artist or item_artist in artist.lower()) and \
           title.lower() in item_title:
            return {
                "jellyfin_id": item["Id"],
                "title": item["Name"],
                "artist": item.get("AlbumArtist"),
                "album": item.get("Album"),
                "path": item.get("Path"),
            }
    return None


async def search_tracks(query: str, limit: int = 20) -> list[dict]:
    data = await _jf_request(
        "GET", "/Items",
        params={
            "IncludeItemTypes": "Audio",
            "SearchTerm": query,
            "Recursive": "true",
            "Fields": "AlbumArtist,Album,Path,RunTimeTicks",
            "Limit": limit,
        }
    )
    if not data:
        return []
    results = []
    for item in data.get("Items", []):
        results.append({
            "jellyfin_id": item["Id"],
            "title": item.get("Name"),
            "artist": item.get("AlbumArtist"),
            "album": item.get("Album"),
            "duration_ms": (item.get("RunTimeTicks", 0) or 0) // 10000,
        })
    return results


async def find_tracks_by_artist_album(artist: str, album: str) -> list[dict]:
    """Find all tracks for a specific artist + album in Jellyfin."""
    data = await _jf_request(
        "GET", "/Items",
        params={
            "IncludeItemTypes": "Audio",
            "AlbumArtists": artist,
            "Albums": album,
            "Recursive": "true",
            "Fields": "AlbumArtist,Album,Path,RunTimeTicks,IndexNumber",
            "SortBy": "IndexNumber",
            "SortOrder": "Ascending",
            "Limit": 100,
        }
    )
    if not data:
        return []
    results = []
    for item in data.get("Items", []):
        results.append({
            "jellyfin_id": item["Id"],
            "title": item.get("Name"),
            "artist": item.get("AlbumArtist"),
            "album": item.get("Album"),
            "track_number": item.get("IndexNumber"),
        })
    return results


async def get_or_create_playlist(name: str) -> str | None:
    """Get existing playlist by name or create a new one. Returns Jellyfin playlist ID."""
    user_id = await _get_user_id()

    # Search for existing
    data = await _jf_request(
        "GET", "/Items",
        params={
            "IncludeItemTypes": "Playlist",
            "SearchTerm": name,
            "Recursive": "true",
            "Limit": 10,
        }
    )
    if data and data.get("Items"):
        for item in data["Items"]:
            if item.get("Name", "").lower() == name.lower():
                log.info("Found existing playlist: %s (%s)", name, item["Id"])
                return item["Id"]

    # Create new — must include userId for API key auth
    create_params = {
        "Name": name,
        "MediaType": "Audio",
    }
    if user_id:
        create_params["UserId"] = user_id

    result = await _jf_request("POST", "/Playlists", json_data=create_params)
    if result:
        playlist_id = result.get("Id")
        log.info("Created Jellyfin playlist: %s (%s)", name, playlist_id)
        return playlist_id

    return None


async def add_tracks_to_playlist(playlist_id: str, track_jellyfin_ids: list[str]) -> bool:
    if not track_jellyfin_ids:
        return True
    user_id = await _get_user_id()
    params = {"ids": ",".join(track_jellyfin_ids)}
    if user_id:
        params["userId"] = user_id
    result = await _jf_request(
        "POST",
        f"/Playlists/{playlist_id}/Items",
        params=params
    )
    return result is not None


async def remove_tracks_from_playlist(playlist_id: str, entry_ids: list[str]) -> bool:
    if not entry_ids:
        return True
    user_id = await _get_user_id()
    params = {"EntryIds": ",".join(entry_ids)}
    if user_id:
        params["userId"] = user_id
    result = await _jf_request(
        "DELETE",
        f"/Playlists/{playlist_id}/Items",
        params=params
    )
    return result is not None


async def get_playlist_items(playlist_id: str) -> list[dict]:
    user_id = await _get_user_id()
    params = {
        "Fields": "AlbumArtist,Album,Path",
        "Limit": 500,
    }
    if user_id:
        params["userId"] = user_id
    data = await _jf_request("GET", f"/Playlists/{playlist_id}/Items", params=params)
    if not data:
        return []
    results = []
    for item in data.get("Items", []):
        results.append({
            "jellyfin_id": item["Id"],
            "playlist_item_id": item.get("PlaylistItemId"),
            "title": item.get("Name"),
            "artist": item.get("AlbumArtist"),
            "album": item.get("Album"),
        })
    return results


async def clear_playlist(playlist_id: str) -> bool:
    items = await get_playlist_items(playlist_id)
    if not items:
        return True
    entry_ids = [item["playlist_item_id"] for item in items if item.get("playlist_item_id")]
    if entry_ids:
        return await remove_tracks_from_playlist(playlist_id, entry_ids)
    return True


async def test_connection() -> bool:
    result = await _jf_request("GET", "/System/Info/Public")
    return result is not None
