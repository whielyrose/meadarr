"""
Settings API for Meadarr.
All configuration managed through the web UI, stored in SQLite.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from database.models import get_setting, set_setting, get_all_settings
from services import slskd, jellyfin, lastfm, notifier
from services import listenbrainz

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    # slskd
    slskd_url: str | None = None
    slskd_api_key: str | None = None
    # Jellyfin
    jellyfin_url: str | None = None
    jellyfin_api_key: str | None = None
    # Last.fm
    lastfm_api_key: str | None = None
    lastfm_username: str | None = None
    # ListenBrainz
    listenbrainz_token: str | None = None
    listenbrainz_username: str | None = None
    # Fluxer
    fluxer_webhook_url: str | None = None
    # Download preferences
    default_format: str | None = None
    upgrade_to_flac: str | None = None
    auto_scan_interval_hours: str | None = None


SENSITIVE_KEYS = {
    "slskd_api_key", "jellyfin_api_key",
    "lastfm_api_key", "listenbrainz_token", "fluxer_webhook_url"
}


@router.get("")
async def get_settings():
    """Get all settings, masking sensitive values."""
    all_settings = get_all_settings()
    for key in SENSITIVE_KEYS:
        if all_settings.get(key):
            all_settings[key] = "***configured***"
    return all_settings


@router.post("")
async def update_settings(body: SettingsUpdate):
    """Update one or more settings."""
    updates = body.model_dump(exclude_none=True)
    for key, value in updates.items():
        if value is not None:
            set_setting(key, str(value))
    return {"status": "ok", "updated": list(updates.keys())}


@router.post("/test/slskd")
async def test_slskd():
    ok = await slskd.test_connection()
    if not ok:
        raise HTTPException(400, "Could not connect to slskd. Check URL and API key.")
    return {"status": "ok", "message": "slskd connection successful"}


@router.post("/test/jellyfin")
async def test_jellyfin():
    ok = await jellyfin.test_connection()
    if not ok:
        raise HTTPException(400, "Could not connect to Jellyfin. Check URL and API key.")
    libs = await jellyfin.get_music_libraries()
    return {
        "status": "ok",
        "message": "Jellyfin connection successful",
        "music_libraries": libs,
    }


@router.post("/test/lastfm")
async def test_lastfm():
    ok = await lastfm.test_connection()
    if not ok:
        raise HTTPException(400, "Could not connect to Last.fm. Check API key.")
    return {"status": "ok", "message": "Last.fm connection successful"}


@router.post("/test/listenbrainz")
async def test_listenbrainz():
    ok = await listenbrainz.test_connection()
    if not ok:
        raise HTTPException(400, "Could not connect to ListenBrainz. Check username and token.")
    return {"status": "ok", "message": "ListenBrainz connection successful"}


@router.post("/test/fluxer")
async def test_fluxer():
    webhook_url = get_setting("fluxer_webhook_url")
    if not webhook_url:
        raise HTTPException(400, "Fluxer webhook URL not configured")
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                webhook_url,
                json={"embeds": [{
                    "title": "Meadarr Test",
                    "description": "Meadarr webhook connection is working!",
                    "color": 0x4ade80,
                }]},
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status in (200, 204):
                    return {"status": "ok", "message": "Test notification sent to Fluxer"}
                raise HTTPException(400, f"Fluxer returned {resp.status}")
    except Exception as e:
        raise HTTPException(400, f"Failed to reach Fluxer webhook: {e}")
