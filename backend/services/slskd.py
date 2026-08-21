"""
slskd HTTP API client for Meadarr.
Handles search, download queueing, and transfer monitoring.
All credentials read from DB settings.
"""
import asyncio
import logging
import aiohttp
from database.models import get_setting

log = logging.getLogger("meadarr.slskd")

# Minimum score to auto-download (0.0 - 1.0)
AUTO_DOWNLOAD_THRESHOLD = 0.65
# Minimum score to even consider (below this = reject)
MINIMUM_SCORE_THRESHOLD = 0.40


def _get_config() -> tuple[str, str] | None:
    """Get slskd URL and API key from settings."""
    url = get_setting("slskd_url")
    api_key = get_setting("slskd_api_key")
    if not url or not api_key:
        return None
    return url.rstrip("/"), api_key


async def _slskd_request(method: str, path: str, json_data: dict = None, params: dict = None) -> dict | None:
    """Make an authenticated request to slskd."""
    config = _get_config()
    if not config:
        log.error("slskd not configured")
        return None
    url, api_key = config

    headers = {
        "X-API-Key": api_key,
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
                    log.error("slskd %s %s returned %s: %s", method, path, resp.status, body[:200])
                    return None
    except Exception as e:
        log.error("slskd request error: %s", e)
        return None


def score_result(result: dict, artist: str, album: str, expected_tracks: int = 0, preferred_format: str = "mp3") -> float:
    """
    Score a slskd search result for relevance and quality.
    Returns a float 0.0 - 1.0.

    Scoring breakdown:
    - 35% format match (preferred format scores highest)
    - 25% folder/filename relevance to artist+album
    - 20% track completeness (if we know how many tracks expected)
    - 10% file size sanity (too small = probably bad)
    - 10% peer quality signals
    """
    score = 0.0
    filename = result.get("filename", "").lower()
    directory = result.get("directory", "").lower()
    full_path = f"{directory} {filename}".lower()
    size = result.get("size", 0)

    # ── Format scoring (35%) ──────────────────────────────────────────────────
    if preferred_format == "mp3":
        if filename.endswith(".mp3"):
            score += 0.35
        elif filename.endswith(".flac"):
            score += 0.25  # flac is fine but not preferred
        elif filename.endswith((".m4a", ".aac", ".ogg", ".opus")):
            score += 0.15
        else:
            score += 0.0   # reject unknown formats
    elif preferred_format == "flac":
        if filename.endswith(".flac"):
            score += 0.35
        elif filename.endswith(".mp3"):
            score += 0.20
        elif filename.endswith((".m4a", ".aac")):
            score += 0.10
        else:
            score += 0.0

    # ── Relevance scoring (25%) ───────────────────────────────────────────────
    artist_lower = artist.lower()
    album_lower = album.lower() if album else ""

    artist_in_path = artist_lower in full_path
    album_in_path = album_lower in full_path if album_lower else False

    if artist_in_path and album_in_path:
        score += 0.25
    elif artist_in_path:
        score += 0.15
    elif album_in_path:
        score += 0.10
    else:
        score += 0.0

    # ── Size sanity (10%) ─────────────────────────────────────────────────────
    # MP3 should be at least 2MB, FLAC at least 10MB for a real song
    if filename.endswith(".mp3") and size > 2_000_000:
        score += 0.10
    elif filename.endswith(".flac") and size > 10_000_000:
        score += 0.10
    elif size > 1_000_000:
        score += 0.05

    # ── Junk filter (penalise) ────────────────────────────────────────────────
    junk_terms = ["sample", "preview", "karaoke", "instrumental", "cover", "tribute", "remix"]
    if any(term in full_path for term in junk_terms):
        score -= 0.20

    return max(0.0, min(1.0, score))


def score_album_group(results: list[dict], artist: str, album: str,
                      expected_tracks: int, preferred_format: str = "mp3") -> dict | None:
    """
    Group results by peer/folder and score each group as a complete album.
    Returns the best group or None if nothing meets the threshold.
    """
    # Group by (peer, directory)
    groups: dict[tuple, list] = {}
    for result in results:
        key = (result.get("username", ""), result.get("directory", ""))
        groups.setdefault(key, []).append(result)

    best_group = None
    best_score = MINIMUM_SCORE_THRESHOLD

    for (peer, directory), files in groups.items():
        # Score each file in the group
        file_scores = [score_result(f, artist, album, expected_tracks, preferred_format) for f in files]
        avg_file_score = sum(file_scores) / len(file_scores) if file_scores else 0

        # Completeness bonus — how many tracks did we find?
        if expected_tracks > 0:
            completeness = min(len(files) / expected_tracks, 1.0)
        else:
            completeness = 0.5  # unknown expected, neutral

        # Format consistency bonus
        formats = set()
        for f in files:
            fname = f.get("filename", "").lower()
            if fname.endswith(".mp3"):
                formats.add("mp3")
            elif fname.endswith(".flac"):
                formats.add("flac")
            else:
                formats.add("other")
        format_consistency = 1.0 if len(formats) == 1 else 0.7

        # Final group score
        group_score = (
            0.50 * avg_file_score +
            0.30 * completeness +
            0.20 * format_consistency
        )

        if group_score > best_score:
            best_score = group_score
            best_group = {
                "peer": peer,
                "directory": directory,
                "files": files,
                "score": group_score,
                "track_count": len(files),
                "format": list(formats)[0] if len(formats) == 1 else "mixed",
            }

    return best_group


async def search(query: str, timeout_ms: int = 10000) -> dict | None:
    """
    Start a slskd search and wait for results.
    Returns search result data or None.
    """
    # Start search
    search_data = await _slskd_request("POST", "/api/v0/searches", json_data={
        "searchText": query,
        "fileLimit": 100,
        "filterResponses": True,
        "minimumResponseFileCount": 1,
        "timeout": timeout_ms,
    })

    if not search_data:
        return None

    search_id = search_data.get("id")
    if not search_id:
        return None

    # Poll for completion
    max_wait = (timeout_ms / 1000) + 5
    waited = 0
    while waited < max_wait:
        await asyncio.sleep(2)
        waited += 2

        status = await _slskd_request("GET", f"/api/v0/searches/{search_id}")
        if not status:
            break

        state = status.get("state", "")
        if "Completed" in state or "TimedOut" in state:
            break

    # Get results
    results_data = await _slskd_request(
        "GET",
        f"/api/v0/searches/{search_id}/responses",
    )

    # Clean up search
    await _slskd_request("DELETE", f"/api/v0/searches/{search_id}")

    return results_data


async def search_album(artist: str, album: str, year: str = None,
                       expected_tracks: int = 0, preferred_format: str = "mp3") -> dict | None:
    """
    Search slskd for an album and return the best scoring group.
    Tries multiple search queries for better coverage.
    """
    queries = [
        f"{artist} {album}",
        f"{artist} {album} {year}" if year else None,
        f"{album} {artist}",
    ]
    queries = [q for q in queries if q]

    all_results = []
    for query in queries:
        log.info("slskd searching: %s", query)
        results = await search(query, timeout_ms=8000)
        if results:
            # Flatten responses
            for response in results if isinstance(results, list) else []:
                for file in response.get("files", []):
                    file["username"] = response.get("username", "")
                    all_results.append(file)

    if not all_results:
        log.info("No slskd results for %s - %s", artist, album)
        return None

    log.info("slskd found %d files for %s - %s, scoring...", len(all_results), artist, album)
    best = score_album_group(all_results, artist, album, expected_tracks, preferred_format)

    if best:
        log.info("Best match: peer=%s score=%.2f tracks=%d format=%s",
                 best["peer"], best["score"], best["track_count"], best["format"])
    else:
        log.info("No group met the minimum score threshold for %s - %s", artist, album)

    return best


async def download_file(peer: str, filename: str) -> dict | None:
    """Queue a file for download from a specific peer."""
    result = await _slskd_request("POST", "/api/v0/transfers/downloads", json_data={
        "username": peer,
        "files": [{"filename": filename}]
    })
    return result


async def download_album_group(group: dict) -> list[dict]:
    """Download all files in a scored album group."""
    peer = group["peer"]
    files = group["files"]
    download_ids = []

    for file in files:
        filename = file.get("filename")
        if not filename:
            continue
        result = await download_file(peer, filename)
        if result:
            download_ids.append({
                "filename": filename,
                "peer": peer,
                "slskd_id": result.get("id") if isinstance(result, dict) else None,
            })
        await asyncio.sleep(0.5)  # small delay between queuing files

    log.info("Queued %d/%d files for download from %s", len(download_ids), len(files), peer)
    return download_ids


async def get_transfer_status(peer: str, filename: str) -> dict | None:
    """Get the status of a specific transfer."""
    result = await _slskd_request(
        "GET",
        f"/api/v0/transfers/downloads/{peer}",
    )
    if not result:
        return None

    # Find the specific file
    if isinstance(result, list):
        for transfer in result:
            if transfer.get("filename") == filename:
                return transfer
    return None


async def get_all_downloads() -> list[dict]:
    """Get all active and completed downloads from slskd."""
    result = await _slskd_request("GET", "/api/v0/transfers/downloads")
    if not result:
        return []
    return result if isinstance(result, list) else []


async def test_connection() -> bool:
    """Test slskd connection."""
    config = _get_config()
    if not config:
        return False
    result = await _slskd_request("GET", "/api/v0/application")
    return result is not None
