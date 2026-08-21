"""
Playlists API for Meadarr.
Creates and manages playlists, syncing them to Jellyfin.
"""
import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database.models import get_connection
from services import jellyfin, notifier

log = logging.getLogger("meadarr.api.playlists")
router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class PlaylistCreate(BaseModel):
    name: str
    description: str | None = None


class PlaylistAddTracks(BaseModel):
    # Either provide jellyfin_item_ids directly,
    # or artist+title+album to search for tracks in Jellyfin
    jellyfin_item_ids: list[str] | None = None
    tracks: list[dict] | None = None  # [{artist, title, album}]


@router.get("")
async def list_playlists():
    """List all playlists."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT p.*, COUNT(pt.playlist_id) as track_count
               FROM playlists p
               LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
               GROUP BY p.id
               ORDER BY p.updated_at DESC"""
        ).fetchall()
        return {"playlists": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.post("")
async def create_playlist(body: PlaylistCreate):
    """Create a new empty playlist."""
    # Create in Jellyfin
    jellyfin_id = await jellyfin.get_or_create_playlist(body.name)

    conn = get_connection()
    try:
        # Check if already exists locally
        existing = conn.execute(
            "SELECT id FROM playlists WHERE LOWER(name) = LOWER(?)", (body.name,)
        ).fetchone()

        if existing:
            if jellyfin_id:
                conn.execute(
                    "UPDATE playlists SET jellyfin_id = ?, description = ?, updated_at = ? WHERE id = ?",
                    (jellyfin_id, body.description, int(time.time()), existing["id"])
                )
                conn.commit()
            return {"id": existing["id"], "message": "Playlist already exists, updated Jellyfin ID"}

        cursor = conn.execute(
            """INSERT INTO playlists (name, description, jellyfin_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (body.name, body.description, jellyfin_id, int(time.time()), int(time.time()))
        )
        playlist_id = cursor.lastrowid
        conn.commit()
        return {"id": playlist_id, "jellyfin_id": jellyfin_id, "name": body.name}
    finally:
        conn.close()


@router.get("/{playlist_id}")
async def get_playlist(playlist_id: int):
    """Get a playlist with its tracks."""
    conn = get_connection()
    try:
        playlist = conn.execute(
            "SELECT * FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        if not playlist:
            raise HTTPException(404, "Playlist not found")

        tracks = conn.execute(
            """SELECT pt.*, lt.artist, lt.album, lt.title, lt.format, lt.file_path
               FROM playlist_tracks pt
               LEFT JOIN library_tracks lt ON lt.id = pt.library_track_id
               WHERE pt.playlist_id = ?
               ORDER BY pt.position""",
            (playlist_id,)
        ).fetchall()

        return {
            **dict(playlist),
            "tracks": [dict(t) for t in tracks],
        }
    finally:
        conn.close()


@router.post("/{playlist_id}/tracks")
async def add_tracks_to_playlist(playlist_id: int, body: PlaylistAddTracks):
    """
    Add tracks to a playlist.
    Can accept direct Jellyfin item IDs or search terms.
    """
    conn = get_connection()
    try:
        playlist = conn.execute(
            "SELECT * FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        if not playlist:
            raise HTTPException(404, "Playlist not found")
        playlist = dict(playlist)
    finally:
        conn.close()

    jellyfin_ids = []

    # Direct Jellyfin IDs
    if body.jellyfin_item_ids:
        jellyfin_ids.extend(body.jellyfin_item_ids)

    # Search for tracks by artist+title
    if body.tracks:
        for track_info in body.tracks:
            artist = track_info.get("artist", "")
            title = track_info.get("title", "")
            album = track_info.get("album", "")
            found = await jellyfin.find_track(artist, album, title)
            if found:
                jellyfin_ids.append(found["jellyfin_id"])
            else:
                log.warning("Track not found in Jellyfin: %s - %s", artist, title)

    if not jellyfin_ids:
        raise HTTPException(400, "No tracks could be found to add")

    # Add to Jellyfin playlist
    jellyfin_playlist_id = playlist.get("jellyfin_id")
    if jellyfin_playlist_id:
        await jellyfin.add_tracks_to_playlist(jellyfin_playlist_id, jellyfin_ids)

    # Add to local DB
    conn = get_connection()
    try:
        # Get current max position
        max_pos = conn.execute(
            "SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?",
            (playlist_id,)
        ).fetchone()[0] or 0

        for i, jf_id in enumerate(jellyfin_ids):
            # Try to find matching library track
            lib_track = conn.execute(
                "SELECT id, artist, album, title FROM library_tracks WHERE file_path LIKE '%' LIMIT 1"
            ).fetchone()

            conn.execute(
                """INSERT OR IGNORE INTO playlist_tracks
                   (playlist_id, jellyfin_item_id, position, added_at)
                   VALUES (?, ?, ?, ?)""",
                (playlist_id, jf_id, max_pos + i + 1, int(time.time()))
            )

        conn.execute(
            "UPDATE playlists SET updated_at = ? WHERE id = ?",
            (int(time.time()), playlist_id)
        )
        conn.commit()
    finally:
        conn.close()

    await notifier.notify_playlist_created(playlist["name"], len(jellyfin_ids))
    return {"status": "ok", "tracks_added": len(jellyfin_ids)}


@router.delete("/{playlist_id}/tracks")
async def remove_track_from_playlist(playlist_id: int, position: int):
    """Remove a track from a playlist by position."""
    conn = get_connection()
    try:
        playlist = conn.execute(
            "SELECT * FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        if not playlist:
            raise HTTPException(404, "Playlist not found")

        track = conn.execute(
            "SELECT * FROM playlist_tracks WHERE playlist_id = ? AND position = ?",
            (playlist_id, position)
        ).fetchone()
        if not track:
            raise HTTPException(404, "Track not found at that position")

        # Remove from Jellyfin if we have the playlist item ID
        # (Jellyfin uses playlist item IDs, not positions, for removal)
        # This would require fetching items from Jellyfin first

        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ? AND position = ?",
            (playlist_id, position)
        )
        conn.execute(
            "UPDATE playlists SET updated_at = ? WHERE id = ?",
            (int(time.time()), playlist_id)
        )
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@router.delete("/{playlist_id}")
async def delete_playlist(playlist_id: int):
    """Delete a playlist (from Meadarr only, not from Jellyfin)."""
    conn = get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Playlist not found")
        conn.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
        conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        conn.commit()
        return {"status": "deleted"}
    finally:
        conn.close()


@router.post("/{playlist_id}/sync-to-jellyfin")
async def sync_playlist_to_jellyfin(playlist_id: int):
    """Force sync a playlist to Jellyfin."""
    conn = get_connection()
    try:
        playlist = conn.execute(
            "SELECT * FROM playlists WHERE id = ?", (playlist_id,)
        ).fetchone()
        if not playlist:
            raise HTTPException(404, "Playlist not found")
        playlist = dict(playlist)

        tracks = conn.execute(
            "SELECT jellyfin_item_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position",
            (playlist_id,)
        ).fetchall()
    finally:
        conn.close()

    # Get or create Jellyfin playlist
    jellyfin_id = playlist.get("jellyfin_id")
    if not jellyfin_id:
        jellyfin_id = await jellyfin.get_or_create_playlist(playlist["name"])
        if jellyfin_id:
            conn = get_connection()
            try:
                conn.execute(
                    "UPDATE playlists SET jellyfin_id = ? WHERE id = ?",
                    (jellyfin_id, playlist_id)
                )
                conn.commit()
            finally:
                conn.close()

    if not jellyfin_id:
        raise HTTPException(500, "Failed to get/create Jellyfin playlist")

    # Clear and rebuild
    await jellyfin.clear_playlist(jellyfin_id)
    jf_ids = [t["jellyfin_item_id"] for t in tracks if t["jellyfin_item_id"]]
    if jf_ids:
        await jellyfin.add_tracks_to_playlist(jellyfin_id, jf_ids)

    return {"status": "synced", "tracks_synced": len(jf_ids), "jellyfin_id": jellyfin_id}
