"""
Spotify playlist fetcher for Meadarr.
Ports Explo's approach: uses Spotify's internal partner API via TOTP authentication.
No API key or user login required. Works for any public playlist.

Based on: https://github.com/LumePart/Explo/blob/dev/src/web/backend/playlist/spotify.go

Flow:
1. Visit open.spotify.com to get cookies, client version, JS bundle URL
2. Generate TOTP using rotating secret from community repo (with hardcoded fallback)
3. Get access token from Spotify's internal token endpoint using TOTP
4. Get client token from clienttoken.spotify.com
5. Extract GraphQL hash from Spotify's webpack JS bundles
6. Query api-partner.spotify.com with GraphQL to get playlist tracks
"""
import asyncio
import base64
import base64 as b32mod
import hashlib
import hmac
import json
import logging
import re
import struct
import time
from http.cookiejar import CookieJar
from urllib.parse import urlencode, urlparse
import aiohttp

log = logging.getLogger("meadarr.spotify")

SPOTIFY_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

# Fallback TOTP secret (from Explo — rotates periodically)
FALLBACK_TOTP_VERSION = 61
FALLBACK_TOTP_SECRET = [
    44, 55, 47, 42, 70, 40, 34, 114, 76, 74,
    50, 111, 120, 97, 75, 76, 94, 102, 43, 69,
    49, 120, 118, 80, 64, 78,
]

# Secret cache
_secret_cache: dict = {}
SECRET_CACHE_TTL = 900  # 15 minutes


async def _fetch_totp_secret() -> tuple[int, list[int]]:
    """
    Fetch the current TOTP secret from community-maintained repo.
    Falls back to hardcoded secret if unavailable.
    """
    global _secret_cache

    now = time.time()
    if _secret_cache.get("secret") and now < _secret_cache.get("expires_at", 0):
        return _secret_cache["version"], _secret_cache["secret"]

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://code.thetadev.de/ThetaDev/spotify-secrets/raw/branch/main/secrets/secretDict.json",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as resp:
                if resp.status == 200:
                    secrets = await resp.json(content_type=None)
                    # Find highest version key
                    max_ver = -1
                    max_key = None
                    for k in secrets:
                        try:
                            v = int(k)
                            if v > max_ver:
                                max_ver = v
                                max_key = k
                        except ValueError:
                            continue

                    if max_ver >= 0 and max_key:
                        secret = secrets[max_key]
                        _secret_cache = {
                            "version": max_ver,
                            "secret": secret,
                            "expires_at": now + SECRET_CACHE_TTL,
                        }
                        log.debug("Fetched Spotify TOTP secret version %d", max_ver)
                        return max_ver, secret
    except Exception as e:
        log.debug("Failed to fetch remote TOTP secret, using fallback: %s", e)

    return FALLBACK_TOTP_VERSION, FALLBACK_TOTP_SECRET


def _generate_totp(secret_bytes: list[int]) -> str:
    """Generate a 6-digit TOTP code from Spotify's secret bytes."""
    # XOR transform (Explo's algorithm)
    transformed = [b ^ ((i % 33) + 9) for i, b in enumerate(secret_bytes)]

    # Join as decimal strings
    joined = ''.join(str(n) for n in transformed)

    # Base32 encode (no padding)
    totp_secret = base64.b32encode(joined.encode()).decode().rstrip('=')

    # RFC 6238 TOTP
    try:
        key = base64.b32decode(totp_secret, casefold=True)
    except Exception:
        padding = (8 - len(totp_secret) % 8) % 8
        key = base64.b32decode(totp_secret + '=' * padding, casefold=True)

    counter = int(time.time()) // 30
    msg = struct.pack('>Q', counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    offset = h[-1] & 0x0f
    code = struct.unpack('>I', h[offset:offset + 4])[0] & 0x7fffffff
    return f"{code % 1000000:06d}"


# Session state (cached for 10 minutes like Explo)
_session_state: dict = {}
SESSION_TTL = 600  # 10 minutes


async def _ensure_session() -> bool:
    """
    Initialize or reuse the Spotify session.
    Four steps: visitHome → fetchAccessToken → fetchClientToken → extractPlaylistHash
    Returns True if session is ready.
    """
    global _session_state

    now = time.time()
    if _session_state.get("valid") and now < _session_state.get("expires_at", 0):
        return True

    log.info("Initializing Spotify session...")
    _session_state = {}

    jar = aiohttp.CookieJar()

    async with aiohttp.ClientSession(cookie_jar=jar) as session:
        # Step 1: Visit home to get client version, device ID, JS bundle URL
        try:
            async with session.get(
                "https://open.spotify.com",
                headers={
                    "User-Agent": SPOTIFY_UA,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
                timeout=aiohttp.ClientTimeout(total=30),
                allow_redirects=True,
            ) as resp:
                if resp.status != 200:
                    log.error("Spotify home returned %d", resp.status)
                    return False
                html = await resp.text()
        except Exception as e:
            log.error("Failed to fetch Spotify home: %s", e)
            return False

        # Extract client version from appServerConfig
        cfg_match = re.search(
            r'<script id="appServerConfig" type="text/plain">(.*?)</script>',
            html, re.DOTALL
        )
        if not cfg_match:
            log.error("appServerConfig not found in Spotify home page")
            return False

        try:
            cfg_json = base64.b64decode(cfg_match.group(1).strip())
            cfg = json.loads(cfg_json)
            client_version = cfg.get("clientVersion", "")
        except Exception as e:
            log.error("Failed to parse appServerConfig: %s", e)
            return False

        # Extract device ID from sp_t cookie
        device_id = ""
        for cookie in jar:
            if cookie.key == "sp_t":
                device_id = cookie.value
                break

        # Find web-player JS bundle
        js_links = re.findall(r'<script[^>]+src="([^"]+\.js)"', html)
        js_pack_url = ""
        for link in js_links:
            if "web-player/web-player" in link and link.endswith(".js"):
                js_pack_url = link
                break

        if not js_pack_url:
            log.error("Web-player JS bundle not found")
            return False

        log.debug("Spotify client version: %s, JS bundle: %s", client_version, js_pack_url[:60])

        # Step 2: Get access token via TOTP
        version, secret_bytes = await _fetch_totp_secret()
        totp = _generate_totp(secret_bytes)

        token_params = urlencode({
            "reason": "init",
            "productType": "web-player",
            "totp": totp,
            "totpVer": str(version),
            "totpServer": totp,
        })

        try:
            async with session.get(
                f"https://open.spotify.com/api/token?{token_params}",
                headers={
                    "User-Agent": SPOTIFY_UA,
                    "Accept": "application/json",
                    "Referer": "https://open.spotify.com/",
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    log.error("Spotify token endpoint returned %d: %s", resp.status, body[:200])
                    return False
                tok = await resp.json()
                access_token = tok.get("accessToken", "")
                client_id = tok.get("clientId", "")
                if not access_token:
                    log.error("Empty access token from Spotify")
                    return False
        except Exception as e:
            log.error("Failed to get Spotify access token: %s", e)
            return False

        log.debug("Got Spotify access token")

        # Step 3: Get client token
        try:
            async with session.post(
                "https://clienttoken.spotify.com/v1/clienttoken",
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": SPOTIFY_UA,
                },
                json={
                    "client_data": {
                        "client_version": client_version,
                        "client_id": client_id,
                        "js_sdk_data": {
                            "device_brand": "unknown",
                            "device_model": "unknown",
                            "os": "windows",
                            "os_version": "NT 10.0",
                            "device_id": device_id,
                            "device_type": "computer",
                        },
                    }
                },
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    log.error("Client token endpoint returned %d: %s", resp.status, body[:200])
                    return False
                ct_data = await resp.json()
                client_token = ct_data.get("granted_token", {}).get("token", "")
                if not client_token:
                    log.error("Empty client token")
                    return False
        except Exception as e:
            log.error("Failed to get client token: %s", e)
            return False

        log.debug("Got Spotify client token")

        # Step 4: Extract fetchPlaylist GraphQL hash from JS bundle
        playlist_hash = await _extract_playlist_hash(session, js_pack_url)
        if not playlist_hash:
            log.error("Could not extract fetchPlaylist hash from JS bundles")
            return False

        log.info("Spotify session ready (hash: %s...)", playlist_hash[:16])

        _session_state = {
            "valid": True,
            "access_token": access_token,
            "client_token": client_token,
            "client_version": client_version,
            "playlist_hash": playlist_hash,
            "expires_at": now + SESSION_TTL,
        }

    return True


async def _extract_playlist_hash(session: aiohttp.ClientSession, js_pack_url: str) -> str:
    """
    Fetch Spotify's webpack JS bundle and extract the fetchPlaylist GraphQL hash.
    Falls back to scanning chunk files.
    """
    try:
        async with session.get(
            js_pack_url,
            headers={"User-Agent": SPOTIFY_UA},
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            if resp.status != 200:
                return ""
            js_content = await resp.text()
    except Exception as e:
        log.error("Failed to fetch JS pack: %s", e)
        return ""

    # Check main bundle first
    h = _find_graphql_hash(js_content, "fetchPlaylist")
    if h:
        return h

    # Extract webpack chunk mappings and scan chunks
    name_map, hash_map = _extract_chunk_mappings(js_content)
    if not name_map or not hash_map:
        return ""

    chunk_files = [
        f"{name_map[k]}.{hash_map[k]}.js"
        for k in name_map
        if k in hash_map
    ]

    log.debug("Scanning %d JS chunks for fetchPlaylist hash", len(chunk_files))

    # Scan chunks concurrently (up to 10 at a time)
    sem = asyncio.Semaphore(10)
    found_hash = ""

    async def check_chunk(filename: str) -> str:
        async with sem:
            url = f"https://open.spotifycdn.com/cdn/build/web-player/{filename}"
            try:
                async with session.get(
                    url,
                    headers={"User-Agent": SPOTIFY_UA},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status != 200:
                        return ""
                    content = await resp.text()
                    return _find_graphql_hash(content, "fetchPlaylist")
            except Exception:
                return ""

    tasks = [check_chunk(f) for f in chunk_files]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for r in results:
        if isinstance(r, str) and r:
            found_hash = r
            break

    return found_hash


def _find_graphql_hash(js_content: str, operation_name: str) -> str:
    """Find a persisted GraphQL query hash by operation name in JS content."""
    needle = f'"{operation_name}","query","'
    idx = js_content.find(needle)
    if idx < 0:
        needle = f'"{operation_name}","mutation","'
        idx = js_content.find(needle)
    if idx < 0:
        return ""

    rest = js_content[idx + len(needle):]
    end = rest.find('"')
    if end < 0:
        return ""
    return rest[:end]


def _extract_chunk_mappings(js_content: str) -> tuple[dict, dict]:
    """Extract webpack chunk name/hash mappings from the main JS bundle."""
    obj_map_re = re.compile(r'\{\d+:"[^"]+"(?:,\d+:"[^"]+")*\}')
    kv_re = re.compile(r'(\d+):"([^"]+)"')

    matches = obj_map_re.findall(js_content)
    if len(matches) < 5:
        return {}, {}

    def parse_map(s: str) -> dict:
        return {int(m[0]): m[1] for m in kv_re.findall(s)}

    name_map = parse_map(matches[4])
    hash_map = parse_map(matches[3])
    return name_map, hash_map


async def _query_partner_api(playlist_id: str, offset: int = 0, limit: int = 343) -> dict | None:
    """
    Query Spotify's internal partner GraphQL API for playlist data.
    Uses the session state (access token, client token, playlist hash).
    """
    state = _session_state

    variables = json.dumps({
        "uri": f"spotify:playlist:{playlist_id}",
        "offset": offset,
        "limit": limit,
        "enableWatchFeedEntrypoint": False,
    })
    extensions = json.dumps({
        "persistedQuery": {
            "version": 1,
            "sha256Hash": state["playlist_hash"],
        }
    })

    params = urlencode({
        "operationName": "fetchPlaylist",
        "variables": variables,
        "extensions": extensions,
    })

    url = f"https://api-partner.spotify.com/pathfinder/v1/query?{params}"

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={
                    "Authorization": f"Bearer {state['access_token']}",
                    "Client-Token": state["client_token"],
                    "Spotify-App-Version": state["client_version"],
                    "Accept": "application/json",
                    "Accept-Language": "en",
                    "User-Agent": SPOTIFY_UA,
                },
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    log.error("Partner API returned %d: %s", resp.status, body[:200])
                    return None
                return await resp.json()
    except Exception as e:
        log.error("Partner API request failed: %s", e)
        return None


def extract_playlist_id(url_or_id: str) -> str | None:
    """Extract playlist ID from Spotify URL, URI, or raw ID."""
    url = url_or_id.strip()
    # Remove query params
    if '?' in url:
        url = url.split('?')[0]

    # Full URL
    m = re.search(r'open\.spotify\.com/(?:[a-z]{2}-[a-z]{2}/|[a-z]{2}/)?playlist/([A-Za-z0-9]+)', url)
    if m:
        return m.group(1)

    # URI
    if url.startswith("spotify:playlist:"):
        return url.split("spotify:playlist:")[1]

    # Raw ID
    if re.match(r'^[A-Za-z0-9]{10,}$', url):
        return url

    return None


def _extract_tracks(items: list) -> list[dict]:
    """Extract track data from partner API response items."""
    tracks = []
    for item in items:
        track_data = item.get("itemV2", {}).get("data", {})
        if not track_data.get("name"):
            continue

        artists = track_data.get("artists", {}).get("items", [])
        artist_names = [
            a.get("profile", {}).get("name", "")
            for a in artists
            if a.get("profile", {}).get("name")
        ]

        tracks.append({
            "title":  track_data.get("name", ""),
            "artist": artist_names[0] if artist_names else "",
            "album":  track_data.get("albumOfTrack", {}).get("name", ""),
        })
    return tracks


async def get_playlist_tracks(playlist_id: str) -> tuple[str, list[dict]]:
    """
    Get all tracks from a public Spotify playlist.
    Returns (playlist_name, list of track dicts).
    Works for any public playlist — no API key needed.
    """
    # Ensure session is ready, retry once if it fails
    if not await _ensure_session():
        log.info("Retrying session initialization...")
        _session_state.clear()
        if not await _ensure_session():
            log.error("Could not initialize Spotify session")
            return "", []

    # Query partner API
    resp = await _query_partner_api(playlist_id, offset=0, limit=343)
    if not resp:
        # Invalidate session and retry once
        log.info("Partner API failed, retrying with fresh session...")
        _session_state.clear()
        if not await _ensure_session():
            return "", []
        resp = await _query_partner_api(playlist_id, offset=0, limit=343)
        if not resp:
            return "", []

    playlist_v2 = resp.get("data", {}).get("playlistV2", {})
    playlist_name = playlist_v2.get("name", "Spotify Playlist")
    content = playlist_v2.get("content", {})
    total_count = content.get("totalCount", 0)
    items = content.get("items", [])

    tracks = _extract_tracks(items)

    # Paginate if needed
    offset = 343
    while offset < total_count:
        page = await _query_partner_api(playlist_id, offset=offset, limit=343)
        if not page:
            log.warning("Pagination failed at offset %d, returning partial results", offset)
            break
        page_items = page.get("data", {}).get("playlistV2", {}).get("content", {}).get("items", [])
        tracks.extend(_extract_tracks(page_items))
        offset += 343

    log.info("Fetched %d tracks from Spotify playlist '%s'", len(tracks), playlist_name)
    return playlist_name, tracks


async def get_playlist_info(playlist_id: str) -> dict | None:
    """Get basic info about a Spotify playlist."""
    if not await _ensure_session():
        return None

    resp = await _query_partner_api(playlist_id, offset=0, limit=1)
    if not resp:
        return None

    playlist_v2 = resp.get("data", {}).get("playlistV2", {})
    if not playlist_v2.get("name"):
        return None

    return {
        "id": playlist_id,
        "name": playlist_v2.get("name", ""),
        "track_count": playlist_v2.get("content", {}).get("totalCount", 0),
    }


async def test_connection() -> bool:
    """Test that Spotify session can be established."""
    _session_state.clear()  # Force fresh session for test
    return await _ensure_session()
