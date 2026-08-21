"""
File tagger and organiser for Meadarr.
Reads existing tags, writes corrected MusicBrainz tags,
and moves files into Jellyfin-preferred folder structure:
  /music/Artist Name/Album Name (Year)/01 - Track Title.mp3
"""
import re
import os
import shutil
import logging
from pathlib import Path
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TALB, TDRC, TRCK, TPOS, ID3NoHeaderError
from mutagen.flac import FLAC
from mutagen.mp4 import MP4
from mutagen import File as MutagenFile

log = logging.getLogger("meadarr.tagger")

MUSIC_PATH = Path(os.environ.get("MUSIC_PATH", "/music"))
SLSKD_DOWNLOADS = Path(os.environ.get("SLSKD_DOWNLOADS_PATH", "/slskd-downloads"))


def sanitise_path_component(name: str) -> str:
    """
    Remove characters invalid in Windows/Linux filenames.
    Jellyfin is on Windows, so we need to be conservative.
    """
    if not name:
        return "Unknown"
    # Remove Windows-invalid chars
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    # Replace multiple spaces with single
    name = re.sub(r'\s+', ' ', name).strip()
    # Remove trailing dots/spaces (Windows issue)
    name = name.rstrip('. ')
    # Truncate to reasonable length
    return name[:100] or "Unknown"


def build_dest_path(artist: str, album: str, year: str | int | None,
                    track_number: int | None, disc_number: int | None,
                    title: str, ext: str) -> Path:
    """
    Build the destination path for a track following Jellyfin's preferred structure:
    /music/Artist/Album (Year)/[disc.]track - Title.ext

    For multi-disc albums: 01.01 - Title.ext (disc.track)
    For single disc: 01 - Title.ext
    """
    artist_safe = sanitise_path_component(artist)
    album_safe = sanitise_path_component(album)
    title_safe = sanitise_path_component(title)
    year_str = f" ({year})" if year else ""
    ext_clean = ext.lstrip(".")

    # Build track prefix
    if disc_number and disc_number > 1:
        track_prefix = f"{disc_number:02d}.{track_number or 1:02d}"
    else:
        track_prefix = f"{track_number or 1:02d}"

    filename = f"{track_prefix} - {title_safe}.{ext_clean}"
    return MUSIC_PATH / artist_safe / f"{album_safe}{year_str}" / filename


def read_tags(file_path: Path) -> dict:
    """Read existing tags from an audio file."""
    tags = {
        "artist": None,
        "album": None,
        "title": None,
        "year": None,
        "track_number": None,
        "disc_number": None,
        "duration_ms": None,
        "format": None,
        "bitrate": None,
    }

    try:
        ext = file_path.suffix.lower()
        tags["format"] = ext.lstrip(".")

        if ext == ".mp3":
            audio = MP3(str(file_path))
            tags["duration_ms"] = int(audio.info.length * 1000)
            tags["bitrate"] = int(audio.info.bitrate / 1000)
            try:
                id3 = ID3(str(file_path))
                tags["title"] = str(id3.get("TIT2", "")) or None
                tags["artist"] = str(id3.get("TPE1", "")) or None
                tags["album"] = str(id3.get("TALB", "")) or None
                year_tag = str(id3.get("TDRC", ""))
                tags["year"] = year_tag[:4] if year_tag else None
                trck = str(id3.get("TRCK", ""))
                tags["track_number"] = int(trck.split("/")[0]) if trck and trck.split("/")[0].isdigit() else None
                tpos = str(id3.get("TPOS", ""))
                tags["disc_number"] = int(tpos.split("/")[0]) if tpos and tpos.split("/")[0].isdigit() else 1
            except ID3NoHeaderError:
                pass

        elif ext == ".flac":
            audio = FLAC(str(file_path))
            tags["duration_ms"] = int(audio.info.length * 1000)
            tags["bitrate"] = int(audio.info.bits_per_sample * audio.info.sample_rate / 1000)
            flac_tags = audio.tags or {}
            tags["title"] = flac_tags.get("title", [None])[0]
            tags["artist"] = flac_tags.get("artist", [None])[0] or flac_tags.get("albumartist", [None])[0]
            tags["album"] = flac_tags.get("album", [None])[0]
            tags["year"] = flac_tags.get("date", [None])[0]
            if tags["year"]:
                tags["year"] = tags["year"][:4]
            trck = flac_tags.get("tracknumber", [None])[0]
            tags["track_number"] = int(trck.split("/")[0]) if trck and trck.split("/")[0].isdigit() else None
            disc = flac_tags.get("discnumber", ["1"])[0]
            tags["disc_number"] = int(disc.split("/")[0]) if disc and disc.split("/")[0].isdigit() else 1

        elif ext in (".m4a", ".aac", ".m4b"):
            audio = MP4(str(file_path))
            tags["duration_ms"] = int(audio.info.length * 1000)
            mp4_tags = audio.tags or {}
            tags["title"] = str(mp4_tags.get("\xa9nam", [None])[0]) if mp4_tags.get("\xa9nam") else None
            tags["artist"] = str(mp4_tags.get("\xa9ART", [None])[0]) if mp4_tags.get("\xa9ART") else None
            tags["album"] = str(mp4_tags.get("\xa9alb", [None])[0]) if mp4_tags.get("\xa9alb") else None
            year = mp4_tags.get("\xa9day", [None])[0]
            tags["year"] = str(year)[:4] if year else None
            trck = mp4_tags.get("trkn", [(None, None)])[0]
            tags["track_number"] = trck[0] if trck and trck[0] else None
            disc = mp4_tags.get("disk", [(None, None)])[0]
            tags["disc_number"] = disc[0] if disc and disc[0] else 1

    except Exception as e:
        log.warning("Could not read tags from %s: %s", file_path, e)

    return tags


def write_tags_mp3(file_path: Path, metadata: dict):
    """Write ID3 tags to an MP3 file."""
    try:
        try:
            id3 = ID3(str(file_path))
        except ID3NoHeaderError:
            id3 = ID3()

        if metadata.get("title"):
            id3["TIT2"] = TIT2(encoding=3, text=metadata["title"])
        if metadata.get("artist"):
            id3["TPE1"] = TPE1(encoding=3, text=metadata["artist"])
        if metadata.get("album"):
            id3["TALB"] = TALB(encoding=3, text=metadata["album"])
        if metadata.get("year"):
            id3["TDRC"] = TDRC(encoding=3, text=str(metadata["year"]))
        if metadata.get("track_number"):
            total = metadata.get("total_tracks", "")
            trck = f"{metadata['track_number']}/{total}" if total else str(metadata["track_number"])
            id3["TRCK"] = TRCK(encoding=3, text=trck)
        if metadata.get("disc_number"):
            id3["TPOS"] = TPOS(encoding=3, text=str(metadata["disc_number"]))

        id3.save(str(file_path))
        log.debug("Tags written to %s", file_path.name)
    except Exception as e:
        log.error("Failed to write tags to %s: %s", file_path, e)


def write_tags_flac(file_path: Path, metadata: dict):
    """Write Vorbis comment tags to a FLAC file."""
    try:
        audio = FLAC(str(file_path))
        if metadata.get("title"):
            audio["title"] = metadata["title"]
        if metadata.get("artist"):
            audio["artist"] = metadata["artist"]
            audio["albumartist"] = metadata["artist"]
        if metadata.get("album"):
            audio["album"] = metadata["album"]
        if metadata.get("year"):
            audio["date"] = str(metadata["year"])
        if metadata.get("track_number"):
            audio["tracknumber"] = str(metadata["track_number"])
        if metadata.get("disc_number"):
            audio["discnumber"] = str(metadata["disc_number"])
        audio.save()
        log.debug("FLAC tags written to %s", file_path.name)
    except Exception as e:
        log.error("Failed to write FLAC tags to %s: %s", file_path, e)


def process_downloaded_file(
    source_path: Path,
    metadata: dict,
) -> Path | None:
    """
    Process a downloaded file:
    1. Read existing tags
    2. Merge with provided metadata (metadata wins for key fields)
    3. Write corrected tags
    4. Move to correct Jellyfin folder structure
    5. Return destination path

    metadata dict should contain: artist, album, title, year,
    track_number, disc_number (all optional but improve organisation)
    """
    if not source_path.exists():
        log.error("Source file not found: %s", source_path)
        return None

    ext = source_path.suffix.lower()
    if ext not in (".mp3", ".flac", ".m4a", ".aac", ".m4b"):
        log.warning("Unsupported format %s, skipping: %s", ext, source_path)
        return None

    # Read existing tags as fallback
    existing_tags = read_tags(source_path)

    # Merge — provided metadata takes priority, existing tags fill gaps
    final_meta = {
        "artist":       metadata.get("artist") or existing_tags.get("artist") or source_path.parent.name,
        "album":        metadata.get("album") or existing_tags.get("album") or source_path.parent.name,
        "title":        metadata.get("title") or existing_tags.get("title") or source_path.stem,
        "year":         metadata.get("year") or existing_tags.get("year"),
        "track_number": metadata.get("track_number") or existing_tags.get("track_number"),
        "disc_number":  metadata.get("disc_number") or existing_tags.get("disc_number") or 1,
    }

    # Write corrected tags
    if ext == ".mp3":
        write_tags_mp3(source_path, final_meta)
    elif ext == ".flac":
        write_tags_flac(source_path, final_meta)
    # m4a/aac tag writing is less critical, skip for now

    # Build destination path
    dest_path = build_dest_path(
        artist=final_meta["artist"],
        album=final_meta["album"],
        year=final_meta["year"],
        track_number=final_meta["track_number"],
        disc_number=final_meta["disc_number"],
        title=final_meta["title"],
        ext=ext,
    )

    # Create destination directory
    dest_path.parent.mkdir(parents=True, exist_ok=True)

    # Move file (atomic rename if same filesystem, copy+delete if not)
    try:
        if dest_path.exists():
            log.warning("Destination already exists, overwriting: %s", dest_path)
            dest_path.unlink()
        source_path.rename(dest_path)
        log.info("Moved %s -> %s", source_path.name, dest_path)
    except OSError:
        # Cross-filesystem move
        shutil.copy2(str(source_path), str(dest_path))
        source_path.unlink()
        log.info("Copied+deleted %s -> %s", source_path.name, dest_path)

    return dest_path


def scan_music_library() -> list[dict]:
    """
    Walk the music library and return all audio files with their tags.
    Used to populate/update the library database.
    """
    if not MUSIC_PATH.exists():
        log.error("Music path does not exist: %s", MUSIC_PATH)
        return []

    supported_extensions = {".mp3", ".flac", ".m4a", ".aac", ".m4b", ".ogg", ".opus"}
    files = []

    for file_path in MUSIC_PATH.rglob("*"):
        if file_path.suffix.lower() not in supported_extensions:
            continue
        if file_path.name.startswith("."):
            continue

        tags = read_tags(file_path)
        tags["file_path"] = str(file_path)
        tags["file_size"] = file_path.stat().st_size
        files.append(tags)

    log.info("Library scan found %d audio files", len(files))
    return files
