# 🍯 Meadarr

Self-hosted music manager connecting slskd (Soulseek), Last.fm, MusicBrainz, and Jellyfin.

## Features

- **Search** — Search MusicBrainz for any artist or album, request it for download
- **Discover** — Last.fm recommendations, top albums, missing from library
- **Queue** — Monitor active downloads with per-file progress
- **Library** — Browse your indexed music library, track duplicates
- **Playlists** — Create playlists and sync them to Jellyfin (appears in Symfonium)
- **Settings** — All configuration via web UI — no .env file needed

## How it works

```
Request album → Dedup check (already have it?) → Search slskd →
Score results (format, completeness, relevance) → Download →
Tag with MusicBrainz metadata → Organise into Artist/Album (Year)/Track structure →
Trigger Jellyfin scan → Update playlist → Notify Fluxer
```

## Docker Compose

```yaml
  meadarr:
    image: ghcr.io/whielyrose/meadarr:latest
    container_name: meadarr
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - //f/jellyfin/config/meadarr:/app/data
      - //f/jellyfin/media/music:/music:rw
      - //f/slskd/downloads:/slskd-downloads:rw
    environment:
      - TZ=Australia/Brisbane
```

## Setup

1. Start the container
2. Open `http://your-server:8090`
3. Go to **Settings** and configure:
   - **slskd** URL + API key
   - **Jellyfin** URL + API key
   - **Last.fm** API key + username
   - **Fluxer** webhook URL (optional)
4. Click **Test** buttons to verify connections
5. Go to **Library → Scan Library** to index existing music
6. Search for an album and click **Request**

## Folder structure

Music is organised into Jellyfin's preferred structure:
```
/music/
  Artist Name/
    Album Name (Year)/
      01 - Track Title.mp3
      02 - Track Title.mp3
```

## Deduplication

Meadarr tracks every file in your library by MusicBrainz ID and artist/album/title.
Before downloading, it checks if you already have the album at the same or better quality.
- Already have MP3, requesting MP3 → skips (already have it)
- Already have MP3, requesting FLAC → downloads as upgrade
- Already have FLAC → never re-downloads

## Playlist sync

Playlists created in Meadarr are synced to Jellyfin and appear in:
- Jellyfin web UI
- Symfonium (Android) — connect to your Jellyfin server
- Any Jellyfin-compatible client
