"""
Discovery API for Meadarr.
Pulls recommendations from Last.fm and ListenBrainz,
cross-references with local library.
"""
from fastapi import APIRouter, Query
from services import lastfm, musicbrainz
from services import listenbrainz
from services.library_scanner import get_album_quality
from database.models import get_setting

router = APIRouter(prefix="/api/discover", tags=["discover"])

PERIODS_LB = {
    "overall": "all_time",
    "7day":    "week",
    "1month":  "month",
    "12month": "year",
}


async def _annotate_with_library_status(items: list[dict], artist_key: str = "name") -> list[dict]:
    for item in items:
        artist = item.get(artist_key) or item.get("artist", "")
        album = item.get("name") or item.get("album", "")
        quality = get_album_quality(artist, album)
        item["in_library"] = quality is not None
        item["library_quality"] = quality
    return items


def _has_lastfm() -> bool:
    return bool(get_setting("lastfm_api_key") and get_setting("lastfm_username"))


def _has_listenbrainz() -> bool:
    return bool(get_setting("listenbrainz_token") and get_setting("listenbrainz_username"))


@router.get("/recommended-artists")
async def get_recommended_artists(limit: int = Query(20, ge=1, le=100)):
    """
    Get artist recommendations based on listening history.
    Uses ListenBrainz if configured, falls back to Last.fm.
    """
    artists = []

    if _has_listenbrainz():
        artists = await listenbrainz.get_recommended_artists(limit=limit)

    if not artists and _has_lastfm():
        artists = await lastfm.get_recommended_artists(limit=limit)

    source = "listenbrainz" if _has_listenbrainz() else "lastfm" if _has_lastfm() else "none"
    return {"artists": artists, "source": source}


@router.get("/top-artists")
async def get_top_artists(
    period: str = Query("overall", regex="^(overall|7day|1month|3month|6month|12month)$"),
    limit: int = Query(20, ge=1, le=100),
):
    """Get user's top artists. Uses ListenBrainz if available, else Last.fm."""
    if _has_listenbrainz():
        lb_period = PERIODS_LB.get(period, "all_time")
        artists = await listenbrainz.get_top_artists(limit=limit, period=lb_period)
        return {"artists": artists, "period": period, "source": "listenbrainz"}

    if _has_lastfm():
        artists = await lastfm.get_user_top_artists(limit=limit, period=period)
        return {"artists": artists, "period": period, "source": "lastfm"}

    return {"artists": [], "period": period, "source": "none",
            "message": "Configure Last.fm or ListenBrainz in Settings"}


@router.get("/top-albums")
async def get_top_albums(
    period: str = Query("overall", regex="^(overall|7day|1month|3month|6month|12month)$"),
    limit: int = Query(20, ge=1, le=100),
):
    """Get user's top albums annotated with library status."""
    if _has_listenbrainz():
        lb_period = PERIODS_LB.get(period, "all_time")
        albums = await listenbrainz.get_top_albums(limit=limit, period=lb_period)
        albums = await _annotate_with_library_status(albums, artist_key="artist")
        return {"albums": albums, "period": period, "source": "listenbrainz"}

    if _has_lastfm():
        albums = await lastfm.get_user_top_albums(limit=limit, period=period)
        albums = await _annotate_with_library_status(albums, artist_key="artist")
        return {"albums": albums, "period": period, "source": "lastfm"}

    return {"albums": [], "period": period, "source": "none"}


@router.get("/similar-artists/{artist}")
async def get_similar_artists(artist: str, limit: int = Query(10, ge=1, le=20)):
    """Get similar artists via Last.fm."""
    similar = await lastfm.get_similar_artists(artist, limit=limit)
    return {"similar": similar, "artist": artist}


@router.get("/artist-top-albums/{artist}")
async def get_artist_top_albums(artist: str, limit: int = Query(10, ge=1, le=20)):
    """Get top albums for an artist from Last.fm."""
    albums = await lastfm.get_top_albums(artist, limit=limit)
    albums = await _annotate_with_library_status(albums, artist_key="artist")
    return {"albums": albums, "artist": artist}


@router.get("/missing-from-library")
async def get_missing_from_library(limit: int = Query(20, ge=1, le=100)):
    """Get user's top albums that are NOT in the local library."""
    albums = []

    if _has_listenbrainz():
        all_albums = await listenbrainz.get_top_albums(limit=limit * 2)
        for album in all_albums:
            quality = get_album_quality(album.get("artist", ""), album.get("name", ""))
            if quality is None:
                album["in_library"] = False
                album["library_quality"] = None
                albums.append(album)
            if len(albums) >= limit:
                break

    elif _has_lastfm():
        all_albums = await lastfm.get_user_top_albums(limit=limit * 2)
        for album in all_albums:
            quality = get_album_quality(album.get("artist", ""), album.get("name", ""))
            if quality is None:
                album["in_library"] = False
                album["library_quality"] = None
                albums.append(album)
            if len(albums) >= limit:
                break

    return {"albums": albums, "count": len(albums)}


@router.get("/new-releases")
async def get_new_releases(limit: int = Query(20, ge=1, le=100)):
    """Get new releases from MusicBrainz for top listened artists."""
    top_artists = []

    if _has_listenbrainz():
        top_artists = await listenbrainz.get_top_artists(limit=10)
    elif _has_lastfm():
        top_artists = await lastfm.get_user_top_artists(limit=10)

    if not top_artists:
        return {"releases": [], "message": "Configure Last.fm or ListenBrainz to see new releases"}

    releases = []
    seen_mbids = set()

    for artist in top_artists[:5]:
        artist_name = artist.get("name") or artist.get("artist_name", "")
        if not artist_name:
            continue

        mb_artists = await musicbrainz.search_artists(artist_name, limit=1)
        if not mb_artists:
            continue

        artist_mbid = mb_artists[0]["mbid"]
        artist_releases = await musicbrainz.get_artist_releases(artist_mbid)

        for release in artist_releases[:3]:
            mbid = release.get("mbid")
            if mbid in seen_mbids:
                continue
            seen_mbids.add(mbid)

            from database.models import get_connection
            conn = get_connection()
            try:
                row = conn.execute(
                    "SELECT format FROM library_tracks WHERE release_mbid = ? LIMIT 1",
                    (mbid,)
                ).fetchone()
                in_library = row is not None
                quality = row["format"] if row else None
            finally:
                conn.close()

            releases.append({
                **release,
                "artist": artist_name,
                "artist_mbid": artist_mbid,
                "in_library": in_library,
                "library_quality": quality,
                "artist_listen_count": artist.get("listen_count", artist.get("playcount", 0)),
            })

    releases.sort(key=lambda x: x.get("artist_listen_count", 0), reverse=True)
    return {"releases": releases[:limit]}
