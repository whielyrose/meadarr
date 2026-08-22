"""
Spotify playlist reader for Meadarr.
Uses web scraping to read public Spotify playlists — no API key needed.
Spotify embeds playlist data as JSON in the page HTML.
"""
import json
import re
import logging
import aiohttp

log = logging.getLogger("meadarr.spotify")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def extract_playlist_id(url_or_id: str) -> str | None:
    """
    Extract playlist ID from a Spotify URL or return the ID directly.
    Handles:
    - https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
    - spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
    - 37i9dQZF1DXcBWIGoYBM5M (raw ID)
    """
    url = url_or_id.strip()

    if "open.spotify.com/playlist/" in url:
        part = url.split("open.spotify.com/playlist/")[1]
        return part.split("?")[0].split("/")[0]

    if url.startswith("spotify:playlist:"):
        return url.split("spotify:playlist:")[1]

    # Raw ID — alphanumeric, typically 22 chars
    if re.match(r'^[A-Za-z0-9]{10,}$', url):
        return url

    return None


async def get_playlist_tracks(playlist_id: str) -> tuple[str, list[dict]]:
    """
    Fetch tracks from a public Spotify playlist by scraping the embed page.
    Returns (playlist_name, list of tracks).
    Each track: {artist, title, album, spotify_id}

    No API key required — reads the JSON data embedded in Spotify's page HTML.
    """
    url = f"https://open.spotify.com/playlist/{playlist_id}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers=HEADERS,
                timeout=aiohttp.ClientTimeout(total=30),
                allow_redirects=True,
            ) as resp:
                if resp.status != 200:
                    log.error("Spotify returned %s for playlist %s", resp.status, playlist_id)
                    return "", []
                html = await resp.text()
    except Exception as e:
        log.error("Failed to fetch Spotify playlist: %s", e)
        return "", []

    # Spotify embeds track data in a <script type="application/ld+json"> tag
    # or in __NEXT_DATA__ / window.__initialState__
    playlist_name = ""
    tracks = []

    # Try JSON-LD first (most reliable)
    json_ld_match = re.search(
        r'<script type="application/ld\+json">(.*?)</script>',
        html, re.DOTALL
    )
    if json_ld_match:
        try:
            data = json.loads(json_ld_match.group(1))
            playlist_name = data.get("name", "")
            for track in data.get("track", []):
                by_artist = track.get("byArtist", {})
                tracks.append({
                    "title":  track.get("name", ""),
                    "artist": by_artist.get("name", "") if isinstance(by_artist, dict) else "",
                    "album":  track.get("inAlbum", {}).get("name", "") if isinstance(track.get("inAlbum"), dict) else "",
                    "spotify_id": None,
                })
            if tracks:
                log.info("Scraped %d tracks from Spotify playlist '%s' via JSON-LD", len(tracks), playlist_name)
                return playlist_name, tracks
        except Exception as e:
            log.warning("JSON-LD parse failed: %s", e)

    # Try Next.js __NEXT_DATA__ (newer Spotify pages)
    next_data_match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html, re.DOTALL
    )
    if next_data_match:
        try:
            data = json.loads(next_data_match.group(1))
            # Navigate to playlist data — path varies by Spotify version
            playlist_data = (
                data.get("props", {})
                    .get("pageProps", {})
                    .get("state", {})
                    .get("data", {})
                    .get("playlist", {})
            )
            if not playlist_data:
                # Try alternate path
                playlist_data = (
                    data.get("props", {})
                        .get("pageProps", {})
                        .get("playlist", {})
                )

            playlist_name = playlist_data.get("name", playlist_name)
            items = playlist_data.get("tracks", {}).get("items", [])
            for item in items:
                track = item.get("track", {})
                if not track:
                    continue
                artists = track.get("artists", [{}])
                tracks.append({
                    "title":      track.get("name", ""),
                    "artist":     artists[0].get("name", "") if artists else "",
                    "album":      track.get("album", {}).get("name", ""),
                    "spotify_id": track.get("id"),
                })
            if tracks:
                log.info("Scraped %d tracks via __NEXT_DATA__", len(tracks))
                return playlist_name, tracks
        except Exception as e:
            log.warning("__NEXT_DATA__ parse failed: %s", e)

    # Fallback: try Open Graph title at minimum
    title_match = re.search(r'<title>(.*?)</title>', html)
    if title_match:
        playlist_name = title_match.group(1).replace(" | Spotify", "").strip()

    if not tracks:
        log.error("Could not extract tracks from Spotify playlist %s. The playlist may be private or Spotify's HTML structure changed.", playlist_id)

    return playlist_name, tracks


async def get_playlist_info(playlist_id: str) -> dict | None:
    """Get basic info about a Spotify playlist (no API key needed)."""
    name, tracks = await get_playlist_tracks(playlist_id)
    if not name and not tracks:
        return None
    return {
        "id": playlist_id,
        "name": name or f"Spotify Playlist {playlist_id[:8]}",
        "description": "",
        "track_count": len(tracks),
    }


async def test_connection() -> bool:
    """Test Spotify scraping works by fetching a known public playlist."""
    # Test with Spotify's own "Top Hits" playlist
    test_id = "37i9dQZF1DXcBWIGoYBM5M"
    name, tracks = await get_playlist_tracks(test_id)
    return len(tracks) > 0
