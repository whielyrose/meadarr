"""
Download orchestrator for Meadarr.
Manages the full pipeline:
  request -> dedup check -> slskd search -> score ->
  download -> poll -> tag -> organise -> library update ->
  Jellyfin scan -> playlist update -> Fluxer notify
"""
import asyncio
import time
import logging
from pathlib import Path
from database.models import get_connection, get_setting
from services import slskd, jellyfin, notifier, musicbrainz
from services.tagger import process_downloaded_file, SLSKD_DOWNLOADS
from services.library_scanner import (
    album_exists, get_album_quality, add_track_to_library
)

log = logging.getLogger("meadarr.orchestrator")

# How long to wait between polling slskd for download progress (seconds)
POLL_INTERVAL = 3
# Maximum time to wait for a download to complete (seconds)
MAX_DOWNLOAD_WAIT = 3600  # 1 hour


def _update_request_status(request_id: int, status: str, error: str = None,
                            download_id: str = None):
    """Update a request's status in the database."""
    conn = get_connection()
    try:
        if status == "completed":
            conn.execute(
                """UPDATE requests SET status = ?, completed_at = ?,
                   error_message = NULL WHERE id = ?""",
                (status, int(time.time()), request_id)
            )
        else:
            conn.execute(
                """UPDATE requests SET status = ?, error_message = ?,
                   download_id = ? WHERE id = ?""",
                (status, error, download_id, request_id)
            )
        conn.commit()
    finally:
        conn.close()


def _add_download_task(request_id: int, peer: str, filename: str,
                        expected_size: int = None) -> int:
    """Record a download task in the database."""
    conn = get_connection()
    try:
        cursor = conn.execute(
            """INSERT INTO download_tasks
               (request_id, peer, filename, expected_size, status)
               VALUES (?, ?, ?, ?, 'queued')""",
            (request_id, peer, filename, expected_size)
        )
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def _update_download_task(task_id: int, status: str, slskd_id: str = None,
                           downloaded_size: int = None, dest_path: str = None):
    """Update a download task status."""
    conn = get_connection()
    try:
        updates = {"status": status}
        if slskd_id:
            updates["slskd_id"] = slskd_id
        if downloaded_size is not None:
            updates["downloaded_size"] = downloaded_size
        if dest_path:
            updates["dest_path"] = dest_path
        if status == "completed":
            updates["completed_at"] = int(time.time())

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE download_tasks SET {set_clause} WHERE id = ?",
            [*updates.values(), task_id]
        )
        conn.commit()
    finally:
        conn.close()


async def _poll_until_complete(peer: str, filename: str,
                                task_id: int, timeout: int = MAX_DOWNLOAD_WAIT) -> bool:
    """
    Poll slskd until a specific file transfer completes.
    Returns True if completed successfully, False if failed/timed out.
    """
    start = time.time()
    fname = Path(filename).name

    while time.time() - start < timeout:
        await asyncio.sleep(POLL_INTERVAL)

        transfers = await slskd.get_all_downloads()
        if not transfers:
            continue

        # Find our transfer
        found = None
        for transfer in transfers:
            # slskd returns transfers grouped or flat depending on version
            if isinstance(transfer, dict):
                # Check if this is our peer's group
                if transfer.get("username") == peer:
                    for file_transfer in transfer.get("directories", [{}]):
                        for f in file_transfer.get("files", []):
                            if Path(f.get("filename", "")).name == fname:
                                found = f
                                break
                    if found:
                        break
                # Flat structure
                if Path(transfer.get("filename", "")).name == fname:
                    found = transfer
                    break

        if not found:
            # Transfer not in active list — either completed/removed or not started yet
            # Search disk recursively for the file
            disk_path = None
            for path in SLSKD_DOWNLOADS.rglob(fname):
                # Prefer clean filenames over slskd numbered duplicates
                parts = path.stem.rsplit("_", 1)
                is_dup = len(parts) == 2 and parts[1].isdigit() and len(parts[1]) > 10
                if not is_dup:
                    disk_path = path
                    break
                elif disk_path is None:
                    disk_path = path

            if disk_path and disk_path.exists():
                log.info("File found on disk (transfer completed/removed): %s", disk_path.name)
                _update_download_task(task_id, "completed",
                                      downloaded_size=disk_path.stat().st_size)
                return True
            # Not found yet — keep waiting
            continue

        state = found.get("state", "").lower()
        size = found.get("bytesTransferred", 0)
        _update_download_task(task_id, "downloading", downloaded_size=size)

        if "succeeded" in state or "completed" in state:
            _update_download_task(task_id, "completed", downloaded_size=size)
            return True
        elif "errored" in state or "cancelled" in state or "failed" in state:
            _update_download_task(task_id, "failed")
            log.error("Transfer failed for %s: %s", fname, state)
            return False

    log.error("Transfer timed out for %s", fname)
    _update_download_task(task_id, "failed")
    return False


def _find_downloaded_file(filename: str) -> Path | None:
    """
    Find a downloaded file in the slskd downloads directory.
    Handles Windows backslash paths from Soulseek peers.
    """
    # Normalise path separators — peers are often Windows
    normalized = filename
    # Replace double backslash then single backslash
    normalized = normalized.replace('\\\\', '/')
    normalized = normalized.replace('\\', '/')
    fname = normalized.split('/')[-1]
    if not fname:
        return None

    # Search recursively, prefer clean files over slskd duplicate suffixes
    # e.g. "Track_639229503459564464.mp3" are duplicates slskd creates
    clean_match = None
    any_match = None
    for path in SLSKD_DOWNLOADS.rglob(fname):
        if any_match is None:
            any_match = path
        parts = path.stem.rsplit('_', 1)
        is_duplicate = (len(parts) == 2 and parts[1].isdigit() and len(parts[1]) > 10)
        if not is_duplicate and clean_match is None:
            clean_match = path

    return clean_match or any_match


async def process_request(request_id: int):
    """
    Main orchestration function for a single download request.
    Runs the full pipeline from search to library import.
    """
    conn = get_connection()
    try:
        request = conn.execute(
            "SELECT * FROM requests WHERE id = ?", (request_id,)
        ).fetchone()
    finally:
        conn.close()

    if not request:
        log.error("Request %d not found", request_id)
        return

    request = dict(request)
    artist = request["artist"]
    album = request.get("album", "")
    title = request.get("title", "")
    year = request.get("year")
    mbid = request.get("mbid")
    req_type = request.get("type", "album")
    format_pref = request.get("format_pref") or get_setting("default_format") or "mp3"

    log.info("Processing request %d: %s - %s (%s)", request_id, artist, album or title, req_type)

    # ── Step 1: Deduplication check ───────────────────────────────────────────
    _update_request_status(request_id, "searching")

    if req_type == "album":
        existing_quality = get_album_quality(artist, album)
        if existing_quality:
            if existing_quality == "flac" or (
                existing_quality == format_pref
            ):
                log.info("Album already in library at %s quality: %s - %s",
                         existing_quality, artist, album)
                _update_request_status(request_id, "duplicate",
                                        error=f"Already in library ({existing_quality})")
                return
            else:
                log.info("Album in library as %s, will try to upgrade to %s",
                         existing_quality, format_pref)

    # ── Step 2: Get track list from MusicBrainz ───────────────────────────────
    expected_tracks = 0
    mb_tracks = []
    if mbid and req_type == "album":
        mb_tracks = await musicbrainz.get_release_tracks(mbid)
        expected_tracks = len(mb_tracks)
        log.info("MusicBrainz says %s has %d tracks", album, expected_tracks)

    # ── Step 3: Search slskd ──────────────────────────────────────────────────
    if req_type == "album":
        best_group = await slskd.search_album(
            artist=artist,
            album=album,
            year=str(year) if year else None,
            expected_tracks=expected_tracks,
            preferred_format=format_pref,
        )
    else:
        # Single track search — try multiple queries for better coverage
        queries = [f"{artist} {title}"]
        if album:
            queries.append(f"{artist} {album} {title}")
        queries.append(f"{title} {artist}")

        all_files = []
        seen_files = set()
        for query in queries:
            log.info("slskd track search: %s", query)
            results = await slskd.search(query, timeout_ms=15000)  # longer timeout for tracks
            if results:
                for response in (results if isinstance(results, list) else []):
                    username = response.get("username", "")
                    for f in response.get("files", []):
                        dedup_key = (username, f.get("filename", ""))
                        if dedup_key in seen_files:
                            continue
                        seen_files.add(dedup_key)
                        f["username"] = username
                        all_files.append(f)

        if all_files:
            # Score using title only (not album — album often empty for track requests)
            scored = []
            for f in all_files:
                score = slskd.score_track_result(f, artist, title, preferred_format=format_pref)
                scored.append((score, f))
            scored.sort(key=lambda x: x[0], reverse=True)

            log.info("Track search found %d files, best score: %.2f",
                     len(all_files), scored[0][0] if scored else 0)

            if scored and scored[0][0] >= slskd.MINIMUM_SCORE_THRESHOLD:
                best_file = scored[0][1]
                best_group = {
                    "peer": best_file.get("username"),
                    "directory": best_file.get("directory"),
                    "files": [best_file],
                    "score": scored[0][0],
                    "track_count": 1,
                    "format": Path(best_file.get("filename", "")).suffix.lstrip("."),
                }
            else:
                best_group = None
        else:
            best_group = None

    if not best_group:
        log.warning("No suitable result found for %s - %s", artist, album or title)
        _update_request_status(request_id, "failed",
                                error="No suitable release found on Soulseek")
        await notifier.notify_download_failed(artist, album or title,
                                               "No suitable release found on Soulseek")
        return

    log.info("Found match: score=%.2f tracks=%d format=%s",
             best_group["score"], best_group["track_count"], best_group["format"])

    # ── Step 4: Queue downloads ───────────────────────────────────────────────
    _update_request_status(request_id, "downloading")
    download_ids = await slskd.download_album_group(best_group)

    if not download_ids:
        _update_request_status(request_id, "failed", error="Failed to queue downloads in slskd")
        await notifier.notify_download_failed(artist, album or title, "Failed to queue downloads")
        return

    # Record download tasks
    task_ids = {}
    for dl in download_ids:
        task_id = _add_download_task(
            request_id=request_id,
            peer=dl["peer"],
            filename=dl["filename"],
        )
        task_ids[dl["filename"]] = task_id

    # ── Step 5: Poll for completion (parallel) ───────────────────────────────
    _update_request_status(request_id, "processing")

    # Poll all files in parallel — slskd downloads them simultaneously
    async def poll_one(dl):
        filename = dl["filename"]
        task_id = task_ids.get(filename)
        peer = dl["peer"]
        success = await _poll_until_complete(peer, filename, task_id)
        return filename, success

    results = await asyncio.gather(*[poll_one(dl) for dl in download_ids])
    completed_files = [fname for fname, ok in results if ok]
    failed_files    = [fname for fname, ok in results if not ok]

    if not completed_files:
        _update_request_status(request_id, "failed", error="All downloads failed or timed out")
        await notifier.notify_download_failed(artist, album or title, "All downloads failed")
        return

    log.info("%d/%d files downloaded successfully for %s - %s",
             len(completed_files), len(download_ids), artist, album or title)

    # ── Step 6: Tag and organise files ────────────────────────────────────────
    imported_paths = []
    mb_track_map = {t.get("title", "").lower(): t for t in mb_tracks} if mb_tracks else {}

    for filename in completed_files:
        source_path = _find_downloaded_file(filename)
        if not source_path:
            log.warning("Could not find downloaded file: %s", filename)
            continue

        # Build metadata for this file
        # Try to match against MusicBrainz track data
        fname_stem = source_path.stem.lower()
        mb_track = None
        for mb_title, mb_t in mb_track_map.items():
            if mb_title in fname_stem or fname_stem in mb_title:
                mb_track = mb_t
                break

        file_metadata = {
            "artist": artist,
            "album": album or title,
            "year": year,
            "mbid": mb_track.get("mbid") if mb_track else None,
            "title": mb_track.get("title") if mb_track else None,
            "track_number": mb_track.get("track_number") if mb_track else None,
            "disc_number": mb_track.get("disc_number") if mb_track else 1,
        }

        dest_path = process_downloaded_file(source_path, file_metadata)
        if dest_path:
            imported_paths.append(dest_path)
            # Add to library DB
            add_track_to_library({
                "mbid": file_metadata.get("mbid"),
                "release_mbid": mbid,
                "artist": artist,
                "album": album or title,
                "title": file_metadata.get("title") or source_path.stem,
                "year": year,
                "track_number": file_metadata.get("track_number"),
                "disc_number": file_metadata.get("disc_number", 1),
                "format": dest_path.suffix.lstrip("."),
                "file_path": str(dest_path),
                "file_size": dest_path.stat().st_size,
            })

    if not imported_paths:
        _update_request_status(request_id, "failed", error="No files could be imported")
        return

    # ── Step 7: Trigger Jellyfin scan ─────────────────────────────────────────
    try:
        await jellyfin.scan_library()
        log.info("Triggered Jellyfin library scan")
    except Exception as e:
        log.error("Jellyfin scan failed: %s", e)

    # ── Step 8: Mark complete and notify ──────────────────────────────────────
    _update_request_status(request_id, "completed")

    await notifier.notify_download_complete(
        artist=artist,
        album=album or title,
        year=str(year) if year else None,
        track_count=len(imported_paths),
        format=best_group.get("format", format_pref),
    )

    log.info("Request %d complete: %d tracks imported for %s - %s",
             request_id, len(imported_paths), artist, album or title)


async def retry_failed_requests():
    """
    Background job: retry failed requests up to 3 times.
    Called by the scheduler.
    """
    conn = get_connection()
    try:
        failed = conn.execute(
            """SELECT id FROM requests
               WHERE status = 'failed'
               AND retry_count < 3
               AND requested_at > ? -- only retry requests from last 7 days
               ORDER BY requested_at ASC
               LIMIT 5""",
            (int(time.time()) - 7 * 86400,)
        ).fetchall()
    finally:
        conn.close()

    for row in failed:
        request_id = row["id"]
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE requests SET retry_count = retry_count + 1, status = 'pending' WHERE id = ?",
                (request_id,)
            )
            conn.commit()
        finally:
            conn.close()
        log.info("Retrying failed request %d", request_id)
        await process_request(request_id)
        await asyncio.sleep(5)  # small delay between retries
