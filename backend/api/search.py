"""
Search API for Meadarr.
Searches MusicBrainz and cross-references with local library.
"""
from fastapi import APIRouter, Query
from services import musicbrainz
from services.library_scanner import album_exists, get_album_quality, get_library_page

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("/releases")
async def search_releases(
    q: str = Query(..., min_length=2, description="Search query"),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Search MusicBrainz for albums/releases.
    Each result is annotated with library status.
    """
    results = await musicbrainz.search_releases(q, limit=limit)

    # Annotate with library status
    for result in results:
        artist = result.get("artist", "")
        album = result.get("title", "")
        existing_quality = get_album_quality(artist, album)
        result["in_library"] = existing_quality is not None
        result["library_quality"] = existing_quality
        result["can_upgrade"] = (
            existing_quality == "mp3" and result.get("type") != "Single"
        )

    return {"results": results, "query": q}


@router.get("/artists")
async def search_artists(
    q: str = Query(..., min_length=2),
    limit: int = Query(10, ge=1, le=20),
):
    """Search MusicBrainz for artists."""
    results = await musicbrainz.search_artists(q, limit=limit)
    return {"results": results, "query": q}


@router.get("/artists/{artist_mbid}/releases")
async def get_artist_releases(artist_mbid: str):
    """Get all releases for an artist from MusicBrainz."""
    releases = await musicbrainz.get_artist_releases(artist_mbid)

    # Annotate with library status
    for release in releases:
        # We don't have artist name here but can check by mbid
        from database.models import get_connection
        conn = get_connection()
        try:
            row = conn.execute(
                "SELECT format FROM library_tracks WHERE release_mbid = ? LIMIT 1",
                (release["mbid"],)
            ).fetchone()
            release["in_library"] = row is not None
            release["library_quality"] = row["format"] if row else None
        finally:
            conn.close()

    return {"releases": releases}


@router.get("/releases/{mbid}/tracks")
async def get_release_tracks(mbid: str):
    """Get tracks for a release group from MusicBrainz."""
    tracks = await musicbrainz.get_release_tracks(mbid)
    return {"tracks": tracks, "mbid": mbid}


@router.get("/library")
async def search_library(
    q: str = Query(None),
    artist: str = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
):
    """Search the local library."""
    result = get_library_page(page=page, per_page=per_page, search=q, artist=artist)
    return result
