"""
Discovery API for Meadarr.
Pulls recommendations from Last.fm and cross-references with library.
"""
from fastapi import APIRouter, Query
from services import lastfm, musicbrainz
from services.library_scanner import album_exists, get_album_quality

router = APIRouter(prefix="/api/discover", tags=["discover"])


async def _annotate_with_library_status(items: list[dict], artist_key: str = "name") -> list[dict]:
    """Add in_library flag to a list of items."""
    for item in items:
        artist = item.get(artist_key) or item.get("artist", "")
        album = item.get("name") or item.get("album", "")
        quality = get_album_quality(artist, album)
        item["in_library"] = quality is not None
        item["library_quality"] = quality
    return items


@router.get("/recommended-artists")
async def get_recommended_artists(limit: int = Query(20, ge=1, le=50)):
    """
    Get artist recommendations based on Last.fm listening history.
    Returns artists similar to your top artists that you don't already listen to much.
    """
    artists = await lastfm.get_recommended_artists(limit=limit)
    return {"artists": artists}


@router.get("/top-artists")
async def get_top_artists(
    period: str = Query("overall", regex="^(overall|7day|1month|3month|6month|12month)$"),
    limit: int = Query(20, ge=1, le=50),
):
    """Get user's top artists from Last.fm."""
    artists = await lastfm.get_user_top_artists(limit=limit, period=period)
    return {"artists": artists, "period": period}


@router.get("/top-albums")
async def get_top_albums(
    period: str = Query("overall", regex="^(overall|7day|1month|3month|6month|12month)$"),
    limit: int = Query(20, ge=1, le=50),
):
    """Get user's top albums from Last.fm, annotated with library status."""
    albums = await lastfm.get_user_top_albums(limit=limit, period=period)
    albums = await _annotate_with_library_status(albums, artist_key="artist")
    return {"albums": albums, "period": period}


@router.get("/similar-artists/{artist}")
async def get_similar_artists(artist: str, limit: int = Query(10, ge=1, le=20)):
    """Get artists similar to a given artist via Last.fm."""
    similar = await lastfm.get_similar_artists(artist, limit=limit)
    return {"similar": similar, "artist": artist}


@router.get("/artist-top-albums/{artist}")
async def get_artist_top_albums(artist: str, limit: int = Query(10, ge=1, le=20)):
    """Get top albums for an artist from Last.fm, annotated with library status."""
    albums = await lastfm.get_top_albums(artist, limit=limit)
    albums = await _annotate_with_library_status(albums, artist_key="artist")
    return {"albums": albums, "artist": artist}


@router.get("/missing-from-library")
async def get_missing_from_library(limit: int = Query(20, ge=1, le=50)):
    """
    Get user's top albums from Last.fm that are NOT in the local library.
    Great for filling gaps in your collection.
    """
    top_albums = await lastfm.get_user_top_albums(limit=limit * 2)

    missing = []
    for album in top_albums:
        artist = album.get("artist", "")
        name = album.get("name", "")
        quality = get_album_quality(artist, name)
        if quality is None:
            album["in_library"] = False
            album["library_quality"] = None
            missing.append(album)
        if len(missing) >= limit:
            break

    return {"albums": missing, "count": len(missing)}


@router.get("/new-releases")
async def get_new_releases(limit: int = Query(20, ge=1, le=50)):
    """
    Get new releases from MusicBrainz for the user's top Last.fm artists.
    Cross-referenced with library to show what's missing.
    """
    top_artists = await lastfm.get_user_top_artists(limit=10)
    if not top_artists:
        return {"releases": [], "message": "Configure Last.fm to see new releases"}

    releases = []
    seen_mbids = set()

    for artist in top_artists[:5]:  # limit to avoid too many MB calls
        artist_name = artist["name"]

        # Search MusicBrainz for this artist
        mb_artists = await musicbrainz.search_artists(artist_name, limit=1)
        if not mb_artists:
            continue

        artist_mbid = mb_artists[0]["mbid"]
        artist_releases = await musicbrainz.get_artist_releases(artist_mbid)

        for release in artist_releases[:3]:  # top 3 per artist
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
                "artist_playcount": artist.get("playcount", 0),
            })

    # Sort by artist playcount (most listened first)
    releases.sort(key=lambda x: x.get("artist_playcount", 0), reverse=True)
    return {"releases": releases[:limit]}
