"""
Playlist import API for Meadarr.
Handles importing playlists from:
- ListenBrainz Weekly Jams (and other generated playlists)
- Spotify playlist URLs (no API key required — uses web scraping)
Both check library first, request missing tracks, then create a Jellyfin playlist.
"""
import time
import asyncio
import logging
import aiohttp
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from database.models import get_connection, get_setting
from services import jellyfin, notifier
from services.spotify import extract_playlist_id, get_playlist_tracks, get_playlist_info
from services.library_scanner import track_exists
from services.orchestrator import process_request

log = logging.getLogger("meadarr.api.imports")
router = APIRouter(prefix="/api/imports", tags=["imports"])

LB_BASE = "https://api.listenbrainz.org/1"


class SpotifyImportRequest(BaseModel):
    url: str
    format_pref: str = "mp3"
    download_missing: bool = True
    confirmed: bool = False  # must be True to actually start downloads


async def _lb_get(path: str, token: str) -> dict | None:
    """Make an authenticated ListenBrainz API request."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{LB_BASE}{path}",
                headers={"Authorization": f"Token {token}"},
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    return await resp.json()
                log.warning("ListenBrainz %s returned %s", path, resp.status)
                return None
    except Exception as e:
        log.error("ListenBrainz request error: %s", e)
        return None


def _parse_jspf_tracks(playlist_data: dict) -> list[dict]:
    """
    Parse tracks from a ListenBrainz JSPF playlist.
    JSPF format: playlist.track[].{title, creator, ...}
    The extension field contains MBIDs.
    """
    tracks = []
    for t in playlist_data.get("track", []):
        title   = t.get("title", "")
        creator = t.get("creator", "")
        album   = t.get("album", "")

        # Extract recording MBID from extension if present
        mbid = None
        ext = t.get("extension", {})
        lb_ext = ext.get("https://musicbrainz.org/doc/jspf#track", {})
        mbids = lb_ext.get("additional_metadata", {}).get("recording_mbid") or \
                lb_ext.get("recording_mbid")
        if mbids:
            mbid = mbids if isinstance(mbids, str) else mbids[0] if mbids else None

        if title and creator:
            tracks.append({
                "title":  title,
                "artist": creator,
                "album":  album,
                "mbid":   mbid,
            })
    return tracks


async def _request_missing_track(artist: str, title: str, album: str,
                                  format_pref: str) -> int | None:
    """Create a download request for a missing track."""
    conn = get_connection()
    try:
        cursor = conn.execute(
            """INSERT INTO requests
               (type, artist, title, album, format_pref, status, requested_at)
               VALUES ('track', ?, ?, ?, ?, 'pending', ?)""",
            (artist, title, album, format_pref, int(time.time()))
        )
        request_id = cursor.lastrowid
        conn.commit()
        return request_id
    except Exception as e:
        log.error("Failed to create request: %s", e)
        return None
    finally:
        conn.close()


async def _wait_for_requests(request_ids: list[int], timeout: int = 300) -> dict:
    """Wait for a list of requests to complete."""
    if not request_ids:
        return {}
    start = time.time()
    remaining = set(request_ids)
    results = {}
    while remaining and (time.time() - start) < timeout:
        await asyncio.sleep(5)
        conn = get_connection()
        try:
            for req_id in list(remaining):
                row = conn.execute(
                    "SELECT status FROM requests WHERE id = ?", (req_id,)
                ).fetchone()
                if row and row["status"] in ("completed", "failed", "cancelled", "duplicate"):
                    results[req_id] = row["status"]
                    remaining.discard(req_id)
        finally:
            conn.close()
    for req_id in remaining:
        results[req_id] = "timeout"
    return results


async def _create_jellyfin_playlist(playlist_name: str, tracks: list[dict]) -> str | None:
    """Create a Jellyfin playlist from a list of tracks."""
    jellyfin_ids = []
    not_found = []
    for track in tracks:
        found = await jellyfin.find_track(
            track.get("artist", ""),
            track.get("album", ""),
            track.get("title", ""),
        )
        if found:
            jellyfin_ids.append(found["jellyfin_id"])
        else:
            not_found.append(f"{track.get('artist')} - {track.get('title')}")
    if not_found:
        log.info("%d tracks not found in Jellyfin for '%s'", len(not_found), playlist_name)
    if not jellyfin_ids:
        log.warning("No tracks found in Jellyfin for playlist '%s'", playlist_name)
        return None
    playlist_id = await jellyfin.get_or_create_playlist(playlist_name)
    if not playlist_id:
        return None
    await jellyfin.clear_playlist(playlist_id)
    await jellyfin.add_tracks_to_playlist(playlist_id, jellyfin_ids)
    log.info("Created Jellyfin playlist '%s' with %d/%d tracks",
             playlist_name, len(jellyfin_ids), len(tracks))
    return playlist_id


# ── ListenBrainz Playlist Import ──────────────────────────────────────────────

@router.post("/listenbrainz/weekly-jams")
async def import_weekly_jams(
    background_tasks: BackgroundTasks,
    format_pref: str = "mp3",
    confirmed: bool = False,
):
    """
    Import ListenBrainz Weekly Jams.
    First call without confirmed=True returns a preview.
    Second call with confirmed=True actually downloads missing tracks.
    """
    """
    Import ListenBrainz Weekly Jams playlist.
    Weekly Jams usually contains songs already in your library — it creates
    a playlist from your existing music. Missing tracks will be downloaded.
    Must follow troi-bot on ListenBrainz for playlist generation.
    """
    username = get_setting("listenbrainz_username")
    token    = get_setting("listenbrainz_token")
    if not username or not token:
        raise HTTPException(400, "ListenBrainz username and token must be configured in Settings")

    return await _import_listenbrainz_playlist(
        username=username,
        token=token,
        playlist_type="weekly-jams",
        format_pref=format_pref,
        background_tasks=background_tasks,
        confirmed=confirmed,
    )


@router.post("/listenbrainz/weekly-exploration")
async def import_weekly_exploration(
    background_tasks: BackgroundTasks,
    format_pref: str = "mp3",
    confirmed: bool = False,
):
    """Import ListenBrainz Weekly Exploration playlist (new music discovery)."""
    username = get_setting("listenbrainz_username")
    token    = get_setting("listenbrainz_token")
    if not username or not token:
        raise HTTPException(400, "ListenBrainz username and token must be configured in Settings")

    return await _import_listenbrainz_playlist(
        username=username,
        token=token,
        playlist_type="weekly-exploration",
        format_pref=format_pref,
        background_tasks=background_tasks,
        confirmed=confirmed,
    )


async def _import_listenbrainz_playlist(
    username: str, token: str, playlist_type: str,
    format_pref: str, background_tasks: BackgroundTasks,
    confirmed: bool = False,
):
    """
    Generic ListenBrainz playlist importer.
    Searches createdfor playlists for the given type.
    """
    # Search across multiple endpoints for the playlist
    search_terms = {
        "weekly-jams":        ["weekly jams", "weekly-jams"],
        "weekly-exploration": ["weekly exploration", "weekly-exploration"],
        "daily-jams":         ["daily jams", "daily-jams"],
    }
    terms = search_terms.get(playlist_type, [playlist_type])

    found_playlist = None
    found_mbid = None

    endpoints = [
        f"/user/{username}/playlists/createdfor",
        f"/user/{username}/playlists/collaborations",
        f"/user/{username}/playlists",
    ]

    for endpoint in endpoints:
        data = await _lb_get(endpoint, token)
        if not data:
            continue
        for playlist in data.get("playlists", []):
            pl = playlist.get("playlist", {})
            title = pl.get("title", "").lower()
            if any(term in title for term in terms):
                found_playlist = pl
                found_mbid = pl.get("identifier", "").split("/")[-1]
                log.info("Found '%s' playlist at %s", playlist_type, endpoint)
                break
        if found_playlist:
            break

    if not found_playlist:
        raise HTTPException(
            404,
            f"'{playlist_type}' playlist not found on ListenBrainz. "
            f"Make sure you: 1) Follow troi-bot at listenbrainz.org/user/troi-bot/, "
            f"2) Have enough listening history, "
            f"3) Wait until after Monday when playlists are generated. "
            f"Check listenbrainz.org/user/{username}/playlists/ to verify the playlist exists."
        )

    # If we only have metadata, fetch the full playlist content by MBID
    tracks = _parse_jspf_tracks(found_playlist)

    if not tracks and found_mbid:
        # Fetch full playlist content
        full_data = await _lb_get(f"/playlist/{found_mbid}", token)
        if full_data:
            pl_content = full_data.get("playlist", {})
            tracks = _parse_jspf_tracks(pl_content)
            if not found_playlist.get("title"):
                found_playlist["title"] = pl_content.get("title", playlist_type)

    if not tracks:
        raise HTTPException(
            404,
            f"The '{playlist_type}' playlist exists but contains no tracks. "
            f"This can happen if the playlist was just generated — try again in a few minutes. "
            f"Check listenbrainz.org/user/{username}/playlists/ to verify it has tracks."
        )

    playlist_name = found_playlist.get("title", playlist_type.replace("-", " ").title())
    log.info("Found %d tracks in '%s'", len(tracks), playlist_name)

    # Check library status
    in_library = [t for t in tracks if track_exists(t["artist"], t.get("album", ""), t["title"], t.get("mbid"))]
    missing    = [t for t in tracks if not track_exists(t["artist"], t.get("album", ""), t["title"], t.get("mbid"))]

    log.info("%d in library, %d missing", len(in_library), len(missing))

    # If not confirmed, return preview without downloading
    if not confirmed:
        return {
            "status": "preview",
            "playlist_name": playlist_name,
            "total_tracks": len(tracks),
            "in_library": len(in_library),
            "missing": len(missing),
            "tracks": [
                {
                    "artist": t["artist"],
                    "title": t["title"],
                    "in_library": t in in_library,
                }
                for t in tracks
            ],
            "message": (
                f"Found {len(tracks)} tracks in '{playlist_name}'. "
                f"{len(in_library)} already in library, {len(missing)} missing. "
                f"Confirm to proceed."
            )
        }

    async def _process():
        req_ids = []
        # For weekly-jams, usually skip downloads (songs you already have)
        # For weekly-exploration, download missing songs
        if missing and playlist_type != "weekly-jams":
            for track in missing:
                req_id = await _request_missing_track(
                    track["artist"], track["title"],
                    track.get("album", ""), format_pref
                )
                if req_id:
                    req_ids.append(req_id)
            # Process all requests in parallel
            if req_ids:
                await asyncio.gather(*[process_request(rid) for rid in req_ids])

        # Scan Jellyfin and create playlist
        await jellyfin.scan_library()
        await asyncio.sleep(10)
        playlist_id = await _create_jellyfin_playlist(playlist_name, tracks)
        if playlist_id:
            await notifier.notify_playlist_created(playlist_name, len(tracks))

    background_tasks.add_task(_process)

    return {
        "status": "processing",
        "playlist_name": playlist_name,
        "total_tracks": len(tracks),
        "in_library": len(in_library),
        "missing": len(missing),
        "message": (
            f"Importing '{playlist_name}' ({len(tracks)} tracks). "
            f"{len(in_library)} already in library. "
            + (f"Downloading {len(missing)} missing tracks." if missing and playlist_type != "weekly-jams"
               else f"{len(missing)} missing tracks skipped (Weekly Jams uses existing library).")
            + " Playlist will appear in Jellyfin and Symfonium when ready."
        )
    }


@router.get("/listenbrainz/playlists")
async def list_listenbrainz_playlists():
    """List available ListenBrainz generated playlists."""
    username = get_setting("listenbrainz_username")
    token    = get_setting("listenbrainz_token")
    if not username or not token:
        raise HTTPException(400, "ListenBrainz not configured")

    data = await _lb_get(f"/user/{username}/playlists/createdfor", token)
    if not data:
        return {"playlists": []}

    playlists = []
    for playlist in data.get("playlists", []):
        pl = playlist.get("playlist", {})
        playlists.append({
            "title":   pl.get("title", ""),
            "mbid":    pl.get("identifier", "").split("/")[-1],
            "date":    pl.get("date", ""),
            "creator": pl.get("creator", ""),
        })

    return {"playlists": playlists}


# ── Spotify Playlist Import ───────────────────────────────────────────────────

@router.post("/spotify/playlist")
async def import_spotify_playlist(
    body: SpotifyImportRequest,
    background_tasks: BackgroundTasks,
):
    """
    Import a Spotify playlist by URL.
    Requires Spotify Client ID and Secret configured in Settings.
    First call: returns preview (set download_missing=False, confirmed=False).
    Second call: actually downloads (set confirmed=True).
    """
    playlist_id = extract_playlist_id(body.url)
    if not playlist_id:
        raise HTTPException(400, "Could not extract playlist ID from URL. Use a full Spotify playlist URL like: https://open.spotify.com/playlist/...")

    playlist_name, tracks = await get_playlist_tracks(playlist_id)
    if not tracks:
        raise HTTPException(
            404,
            "Could not fetch tracks from this Spotify playlist. "
            "Make sure it's a public playlist — private playlists cannot be accessed without login."
        )

    if not playlist_name:
        playlist_name = f"Spotify Playlist {playlist_id[:8]}"

    log.info("Spotify import: '%s' with %d tracks", playlist_name, len(tracks))

    # Check library status
    in_library = [t for t in tracks if track_exists(t["artist"], t.get("album", ""), t["title"])]
    missing    = [t for t in tracks if not track_exists(t["artist"], t.get("album", ""), t["title"])]

    # Preview mode — return what would happen without downloading
    if not body.confirmed:
        return {
            "status": "preview",
            "playlist_name": playlist_name,
            "total_tracks": len(tracks),
            "in_library": len(in_library),
            "missing": len(missing),
            "tracks": [
                {
                    "artist": t["artist"],
                    "title": t["title"],
                    "album": t.get("album", ""),
                    "in_library": track_exists(t["artist"], t.get("album", ""), t["title"]),
                }
                for t in tracks[:50]  # show up to 50 for preview
            ],
            "message": (
                f"Found '{playlist_name}' with {len(tracks)} tracks. "
                f"{len(in_library)} already in library, {len(missing)} missing. "
                f"Confirm to start importing."
            )
        }

    async def _process():
        req_ids = []
        if body.download_missing and missing:
            for track in missing:
                req_id = await _request_missing_track(
                    track["artist"], track["title"],
                    track.get("album", ""), body.format_pref
                )
                if req_id:
                    req_ids.append(req_id)
            if req_ids:
                await asyncio.gather(*[process_request(rid) for rid in req_ids])

        await jellyfin.scan_library()
        await asyncio.sleep(15)

        playlist_id_jf = await _create_jellyfin_playlist(playlist_name, tracks)
        if playlist_id_jf:
            await notifier.notify_playlist_created(playlist_name, len(tracks))
            conn = get_connection()
            try:
                existing = conn.execute(
                    "SELECT id FROM playlists WHERE LOWER(name) = LOWER(?)", (playlist_name,)
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE playlists SET jellyfin_id = ?, updated_at = ? WHERE id = ?",
                        (playlist_id_jf, int(time.time()), existing["id"])
                    )
                else:
                    conn.execute(
                        """INSERT INTO playlists (name, description, jellyfin_id, created_at, updated_at)
                           VALUES (?, ?, ?, ?, ?)""",
                        (playlist_name, "Imported from Spotify", playlist_id_jf,
                         int(time.time()), int(time.time()))
                    )
                conn.commit()
            finally:
                conn.close()

    background_tasks.add_task(_process)

    return {
        "status": "processing",
        "playlist_name": playlist_name,
        "total_tracks": len(tracks),
        "in_library": len(in_library),
        "missing": len(missing),
        "download_missing": body.download_missing,
        "message": (
            f"Importing '{playlist_name}' ({len(tracks)} tracks). "
            f"{len(in_library)} already in library"
            + (f", downloading {len(missing)} missing tracks." if body.download_missing and missing else ".")
        )
    }


@router.get("/spotify/playlist/preview")
async def preview_spotify_playlist(url: str):
    """Preview a Spotify playlist without importing. No API key needed."""
    playlist_id = extract_playlist_id(url)
    if not playlist_id:
        raise HTTPException(400, "Invalid Spotify playlist URL")

    playlist_name, tracks = await get_playlist_tracks(playlist_id)
    if not tracks:
        raise HTTPException(404, "Could not fetch playlist — make sure it's public")

    annotated = []
    for track in tracks:
        in_lib = track_exists(track["artist"], track.get("album", ""), track["title"])
        annotated.append({**track, "in_library": in_lib})

    in_library_count = sum(1 for t in annotated if t["in_library"])

    return {
        "playlist": {
            "id": playlist_id,
            "name": playlist_name or f"Playlist {playlist_id[:8]}",
            "track_count": len(tracks),
        },
        "tracks": annotated,
        "in_library": in_library_count,
        "missing": len(annotated) - in_library_count,
    }
