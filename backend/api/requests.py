"""
Download requests API for Meadarr.
Handles creating, viewing, and managing download requests.
"""
import time
import asyncio
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from database.models import get_connection, get_setting
from services.library_scanner import album_exists, get_album_quality
from services.orchestrator import process_request

log = logging.getLogger("meadarr.api.requests")
router = APIRouter(prefix="/api/requests", tags=["requests"])


class AlbumRequest(BaseModel):
    artist: str
    album: str
    year: int | None = None
    mbid: str | None = None          # MusicBrainz release group ID
    format_pref: str | None = None   # 'mp3' or 'flac'
    force: bool = False              # force download even if already in library


class TrackRequest(BaseModel):
    artist: str
    title: str
    album: str | None = None
    mbid: str | None = None          # MusicBrainz recording ID
    format_pref: str | None = None


@router.post("/album")
async def request_album(body: AlbumRequest, background_tasks: BackgroundTasks):
    """
    Request an album download.
    Checks library for duplicates first unless force=True.
    """
    format_pref = body.format_pref or get_setting("default_format") or "mp3"

    # Dedup check
    if not body.force:
        existing = get_album_quality(body.artist, body.album)
        if existing:
            if existing == "flac":
                raise HTTPException(
                    400,
                    f"'{body.album}' is already in library as FLAC. Use force=true to re-download."
                )
            elif existing == format_pref:
                raise HTTPException(
                    400,
                    f"'{body.album}' is already in library as {existing.upper()}. Use force=true to re-download."
                )

    # Create request
    conn = get_connection()
    try:
        cursor = conn.execute(
            """INSERT INTO requests
               (type, mbid, artist, album, year, format_pref, status, requested_at)
               VALUES ('album', ?, ?, ?, ?, ?, 'pending', ?)""",
            (body.mbid, body.artist, body.album, body.year, format_pref, int(time.time()))
        )
        request_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    # Process in background
    background_tasks.add_task(process_request, request_id)

    return {
        "status": "queued",
        "request_id": request_id,
        "message": f"Download queued for {body.artist} - {body.album}",
    }


@router.post("/track")
async def request_track(body: TrackRequest, background_tasks: BackgroundTasks):
    """Request a single track download."""
    format_pref = body.format_pref or get_setting("default_format") or "mp3"

    conn = get_connection()
    try:
        cursor = conn.execute(
            """INSERT INTO requests
               (type, mbid, artist, title, album, format_pref, status, requested_at)
               VALUES ('track', ?, ?, ?, ?, ?, 'pending', ?)""",
            (body.mbid, body.artist, body.title, body.album, format_pref, int(time.time()))
        )
        request_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    background_tasks.add_task(process_request, request_id)

    return {
        "status": "queued",
        "request_id": request_id,
        "message": f"Download queued for {body.artist} - {body.title}",
    }


@router.get("")
async def list_requests(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    """List download requests with optional status filter."""
    conn = get_connection()
    try:
        if status:
            rows = conn.execute(
                """SELECT r.*, COUNT(dt.id) as task_count,
                   SUM(CASE WHEN dt.status='completed' THEN 1 ELSE 0 END) as completed_tasks
                   FROM requests r
                   LEFT JOIN download_tasks dt ON dt.request_id = r.id
                   WHERE r.status = ?
                   GROUP BY r.id
                   ORDER BY r.requested_at DESC
                   LIMIT ? OFFSET ?""",
                (status, limit, offset)
            ).fetchall()
            total = conn.execute(
                "SELECT COUNT(*) FROM requests WHERE status = ?", (status,)
            ).fetchone()[0]
        else:
            rows = conn.execute(
                """SELECT r.*, COUNT(dt.id) as task_count,
                   SUM(CASE WHEN dt.status='completed' THEN 1 ELSE 0 END) as completed_tasks
                   FROM requests r
                   LEFT JOIN download_tasks dt ON dt.request_id = r.id
                   GROUP BY r.id
                   ORDER BY r.requested_at DESC
                   LIMIT ? OFFSET ?""",
                (limit, offset)
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM requests").fetchone()[0]

        return {
            "total": total,
            "requests": [dict(r) for r in rows],
        }
    finally:
        conn.close()


@router.get("/{request_id}")
async def get_request(request_id: int):
    """Get a specific request with its download tasks."""
    conn = get_connection()
    try:
        request = conn.execute(
            "SELECT * FROM requests WHERE id = ?", (request_id,)
        ).fetchone()
        if not request:
            raise HTTPException(404, "Request not found")

        tasks = conn.execute(
            "SELECT * FROM download_tasks WHERE request_id = ? ORDER BY id",
            (request_id,)
        ).fetchall()

        return {
            **dict(request),
            "tasks": [dict(t) for t in tasks],
        }
    finally:
        conn.close()


@router.delete("/{request_id}")
async def cancel_request(request_id: int):
    """Cancel a pending request."""
    conn = get_connection()
    try:
        request = conn.execute(
            "SELECT status FROM requests WHERE id = ?", (request_id,)
        ).fetchone()
        if not request:
            raise HTTPException(404, "Request not found")
        if request["status"] not in ("pending", "failed"):
            raise HTTPException(400, f"Cannot cancel request with status: {request['status']}")

        conn.execute(
            "UPDATE requests SET status = 'cancelled' WHERE id = ?", (request_id,)
        )
        conn.commit()
        return {"status": "cancelled"}
    finally:
        conn.close()


@router.post("/{request_id}/retry")
async def retry_request(request_id: int, background_tasks: BackgroundTasks):
    """Retry a failed request."""
    conn = get_connection()
    try:
        request = conn.execute(
            "SELECT status FROM requests WHERE id = ?", (request_id,)
        ).fetchone()
        if not request:
            raise HTTPException(404, "Request not found")
        if request["status"] != "failed":
            raise HTTPException(400, "Can only retry failed requests")

        conn.execute(
            """UPDATE requests SET status = 'pending', error_message = NULL,
               retry_count = retry_count + 1 WHERE id = ?""",
            (request_id,)
        )
        conn.commit()
    finally:
        conn.close()

    background_tasks.add_task(process_request, request_id)
    return {"status": "retrying", "request_id": request_id}
