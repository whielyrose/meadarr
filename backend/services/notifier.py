"""
Fluxer webhook notification service for Meadarr.
Sends rich embed notifications when downloads complete, fail, etc.
"""
import logging
import aiohttp
from database.models import get_setting

log = logging.getLogger("meadarr.notifier")

COLORS = {
    "success": 0x2ecc71,   # green
    "failed":  0xe74c3c,   # red
    "info":    0x3498db,   # blue
    "warning": 0xe67e22,   # orange
}


async def send_notification(embed: dict):
    """Send an embed to the configured Fluxer webhook."""
    webhook_url = get_setting("fluxer_webhook_url")
    if not webhook_url:
        return

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                webhook_url,
                json={"embeds": [embed]},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status not in (200, 204):
                    body = await resp.text()
                    log.error("Fluxer webhook returned %s: %s", resp.status, body[:100])
    except Exception as e:
        log.error("Failed to send Fluxer notification: %s", e)


async def notify_download_complete(artist: str, album: str, year: str,
                                    track_count: int, format: str):
    """Notify when an album download completes."""
    embed = {
        "title": f"🎵 Downloaded: {artist} — {album}",
        "color": COLORS["success"],
        "fields": [
            {"name": "Year",   "value": str(year) if year else "Unknown", "inline": True},
            {"name": "Tracks", "value": str(track_count), "inline": True},
            {"name": "Format", "value": format.upper(), "inline": True},
        ],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed)


async def notify_download_failed(artist: str, album: str, reason: str):
    """Notify when a download fails."""
    embed = {
        "title": f"❌ Download Failed: {artist} — {album}",
        "description": reason,
        "color": COLORS["failed"],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed)


async def notify_playlist_created(name: str, track_count: int):
    """Notify when a playlist is created/updated."""
    embed = {
        "title": f"📋 Playlist Updated: {name}",
        "description": f"{track_count} tracks synced to Jellyfin",
        "color": COLORS["info"],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed)


async def notify_library_scan_complete(files_added: int, files_updated: int):
    """Notify when a library scan completes."""
    embed = {
        "title": "🔍 Library Scan Complete",
        "color": COLORS["info"],
        "fields": [
            {"name": "Added",   "value": str(files_added),   "inline": True},
            {"name": "Updated", "value": str(files_updated), "inline": True},
        ],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed)
