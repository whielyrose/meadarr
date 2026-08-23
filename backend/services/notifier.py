"""
Fluxer webhook notification service for Meadarr.
Sends rich embed notifications when downloads complete, fail, etc.
Each event type can be individually toggled in Settings.
"""
import logging
import aiohttp
from database.models import get_setting

log = logging.getLogger("meadarr.notifier")

COLORS = {
    "success": 0x2ecc71,
    "failed":  0xe74c3c,
    "info":    0x3498db,
    "warning": 0xe67e22,
}

# Event keys that map to settings toggles.
# Default: True (enabled) — settings can turn each one off
EVENT_KEYS = {
    "download_started":   "notify_download_started",
    "download_complete":  "notify_download_complete",
    "download_failed":    "notify_download_failed",
    "playlist_created":   "notify_playlist_created",
    "library_scan":       "notify_library_scan_complete",
    "import_started":     "notify_import_started",
    "import_complete":    "notify_import_complete",
}


def _event_enabled(event_key: str) -> bool:
    """Check if a specific event type is enabled in settings.
    Defaults to True if not explicitly set."""
    setting_key = EVENT_KEYS.get(event_key)
    if not setting_key:
        return True
    val = get_setting(setting_key)
    # Explicit off only. Default on.
    if val is None:
        return True
    return str(val).lower() not in ("false", "0", "off", "no")


async def send_notification(embed: dict, event_key: str | None = None):
    """Send an embed to Fluxer webhook if the event type is enabled."""
    if event_key and not _event_enabled(event_key):
        log.debug("Event %s is disabled, skipping notification", event_key)
        return

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


async def notify_download_started(artist: str, album: str, track_count: int):
    embed = {
        "title": f"⏬ Download Started: {artist} — {album}",
        "description": f"Queued {track_count} tracks",
        "color": COLORS["info"],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed, event_key="download_started")


async def notify_download_complete(artist: str, album: str, year, track_count: int, format: str):
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
    await send_notification(embed, event_key="download_complete")


async def notify_download_failed(artist: str, album: str, reason: str):
    embed = {
        "title": f"❌ Download Failed: {artist} — {album}",
        "description": reason,
        "color": COLORS["failed"],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed, event_key="download_failed")


async def notify_playlist_created(name: str, track_count: int):
    embed = {
        "title": f"📋 Playlist Updated: {name}",
        "description": f"{track_count} tracks synced to Jellyfin",
        "color": COLORS["info"],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed, event_key="playlist_created")


async def notify_library_scan_complete(files_added: int, files_updated: int):
    embed = {
        "title": "🔍 Library Scan Complete",
        "color": COLORS["info"],
        "fields": [
            {"name": "Added",   "value": str(files_added),   "inline": True},
            {"name": "Updated", "value": str(files_updated), "inline": True},
        ],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed, event_key="library_scan")


async def notify_import_started(playlist_name: str, source: str, total: int, missing: int):
    embed = {
        "title": f"📥 Import Started: {playlist_name}",
        "description": f"Source: {source}",
        "color": COLORS["info"],
        "fields": [
            {"name": "Tracks",  "value": str(total),   "inline": True},
            {"name": "Missing", "value": str(missing), "inline": True},
        ],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed, event_key="import_started")


async def notify_import_complete(playlist_name: str, total: int, downloaded: int, skipped: int):
    embed = {
        "title": f"✅ Import Complete: {playlist_name}",
        "color": COLORS["success"],
        "fields": [
            {"name": "Total",      "value": str(total),      "inline": True},
            {"name": "Downloaded", "value": str(downloaded), "inline": True},
            {"name": "Skipped",    "value": str(skipped),    "inline": True},
        ],
        "footer": {"text": "Meadarr 🍯"},
    }
    await send_notification(embed, event_key="import_complete")
