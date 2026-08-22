import { useState } from 'react'
import { Music2, RefreshCw, Download, CheckCircle, ExternalLink, Sparkles } from 'lucide-react'

interface ImportResult {
  status: string
  playlist_name: string
  total_tracks: number
  in_library: number
  missing: number
  message: string
}

interface SpotifyPreview {
  playlist: { name: string; description: string; track_count: number }
  tracks: Array<{ artist: string; title: string; album: string; in_library: boolean }>
  in_library: number
  missing: number
}

export default function ImportsPage() {
  // Weekly Jams state
  const [jamLoading, setJamLoading]   = useState(false)
  const [jamResult, setJamResult]     = useState<ImportResult | null>(null)
  const [jamError, setJamError]       = useState<string | null>(null)

  // Spotify state
  const [spotifyUrl, setSpotifyUrl]   = useState('')
  const [spotifyFormat, setSpotifyFormat] = useState<'mp3' | 'flac'>('mp3')
  const [spotifyDownload, setSpotifyDownload] = useState(true)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [spotifyPreview, setSpotifyPreview] = useState<SpotifyPreview | null>(null)
  const [spotifyResult, setSpotifyResult]   = useState<ImportResult | null>(null)
  const [spotifyError, setSpotifyError]     = useState<string | null>(null)
  const [previewing, setPreviewing]   = useState(false)

  const importWeeklyJams = async () => {
    setJamLoading(true)
    setJamResult(null)
    setJamError(null)
    try {
      const res = await fetch('/api/imports/listenbrainz/weekly-jams', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setJamResult(data)
    } catch (e: any) {
      setJamError(e.message)
    } finally {
      setJamLoading(false)
    }
  }

  const previewSpotify = async () => {
    if (!spotifyUrl.trim()) return
    setPreviewing(true)
    setSpotifyPreview(null)
    setSpotifyError(null)
    try {
      const res = await fetch(`/api/imports/spotify/playlist/preview?url=${encodeURIComponent(spotifyUrl)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setSpotifyPreview(data)
    } catch (e: any) {
      setSpotifyError(e.message)
    } finally {
      setPreviewing(false)
    }
  }

  const importSpotify = async () => {
    if (!spotifyUrl.trim()) return
    setSpotifyLoading(true)
    setSpotifyResult(null)
    setSpotifyError(null)
    try {
      const res = await fetch('/api/imports/spotify/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: spotifyUrl,
          format_pref: spotifyFormat,
          download_missing: spotifyDownload,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setSpotifyResult(data)
      setSpotifyPreview(null)
    } catch (e: any) {
      setSpotifyError(e.message)
    } finally {
      setSpotifyLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">Import Playlists</h1>

      {/* ── ListenBrainz Weekly Jams ────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="text-honey-400" size={18} />
          <div>
            <h2 className="font-semibold text-gray-200">ListenBrainz Weekly Jams</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Import your personalised Weekly Jams playlist — missing tracks will be downloaded automatically,
              then a playlist is created in Jellyfin.
            </p>
          </div>
        </div>

        {jamResult ? (
          <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-400 font-medium">
              <CheckCircle size={16} /> {jamResult.playlist_name}
            </div>
            <p className="text-sm text-gray-300">{jamResult.message}</p>
            <div className="flex gap-4 text-xs text-gray-400">
              <span>Total: {jamResult.total_tracks}</span>
              <span className="text-green-400">In library: {jamResult.in_library}</span>
              <span className="text-honey-400">Downloading: {jamResult.missing}</span>
            </div>
            <p className="text-xs text-gray-500">
              The playlist will appear in Jellyfin and Symfonium once all downloads complete.
              This runs in the background — you can continue using Meadarr normally.
            </p>
            <button className="btn-secondary text-xs" onClick={() => setJamResult(null)}>
              Import Again
            </button>
          </div>
        ) : (
          <>
            {jamError && (
              <div className="bg-red-900/20 border border-red-800 text-red-300 rounded-lg p-3 text-sm">
                {jamError}
                {jamError.includes('configured') && (
                  <span className="block mt-1 text-xs">
                    Go to Settings and configure your ListenBrainz username and token.
                  </span>
                )}
              </div>
            )}
            <button
              className="btn-primary flex items-center gap-2"
              onClick={importWeeklyJams}
              disabled={jamLoading}
            >
              <RefreshCw size={14} className={jamLoading ? 'animate-spin' : ''} />
              {jamLoading ? 'Fetching Weekly Jams...' : 'Import Weekly Jams'}
            </button>
          </>
        )}
      </div>

      {/* ── Spotify Playlist Import ─────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Music2 className="text-green-400" size={18} />
          <div>
            <h2 className="font-semibold text-gray-200">Spotify Playlist</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Paste a Spotify playlist URL. Missing tracks will be downloaded via slskd,
              then a matching playlist is created in Jellyfin for Symfonium.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Spotify Playlist URL</label>
            <input
              className="input"
              placeholder="https://open.spotify.com/playlist/..."
              value={spotifyUrl}
              onChange={e => { setSpotifyUrl(e.target.value); setSpotifyPreview(null); setSpotifyResult(null) }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Download Format</label>
              <select className="input" value={spotifyFormat}
                onChange={e => setSpotifyFormat(e.target.value as 'mp3' | 'flac')}>
                <option value="mp3">MP3</option>
                <option value="flac">FLAC</option>
              </select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={spotifyDownload}
                  onChange={e => setSpotifyDownload(e.target.checked)}
                  className="w-4 h-4 accent-honey-500" />
                <span className="text-sm text-gray-300">Download missing tracks</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              className="btn-secondary flex items-center gap-1"
              onClick={previewSpotify}
              disabled={!spotifyUrl.trim() || previewing}
            >
              <ExternalLink size={13} />
              {previewing ? 'Loading...' : 'Preview'}
            </button>
            <button
              className="btn-primary flex items-center gap-2"
              onClick={importSpotify}
              disabled={!spotifyUrl.trim() || spotifyLoading}
            >
              <Download size={14} className={spotifyLoading ? 'animate-pulse' : ''} />
              {spotifyLoading ? 'Importing...' : 'Import Playlist'}
            </button>
          </div>
        </div>

        {spotifyError && (
          <div className="bg-red-900/20 border border-red-800 text-red-300 rounded-lg p-3 text-sm">
            {spotifyError}
            {spotifyError.includes('configured') && (
              <span className="block mt-1 text-xs">
                Go to Settings and configure your Spotify Client ID and Secret.
              </span>
            )}
          </div>
        )}

        {/* Preview */}
        {spotifyPreview && (
          <div className="space-y-3">
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="font-medium text-gray-200">{spotifyPreview.playlist.name}</div>
              {spotifyPreview.playlist.description && (
                <div className="text-xs text-gray-500 mt-0.5">{spotifyPreview.playlist.description}</div>
              )}
              <div className="flex gap-4 mt-2 text-xs">
                <span className="text-gray-400">{spotifyPreview.playlist.track_count} tracks total</span>
                <span className="text-green-400">{spotifyPreview.in_library} in library</span>
                <span className="text-honey-400">{spotifyPreview.missing} missing</span>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {spotifyPreview.tracks.map((track, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-gray-800">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${track.in_library ? 'bg-green-500' : 'bg-gray-600'}`} />
                  <span className="text-gray-200 truncate">{track.title}</span>
                  <span className="text-gray-500 truncate">{track.artist}</span>
                  {track.in_library && <span className="ml-auto text-green-500 shrink-0">✓</span>}
                </div>
              ))}
              {spotifyPreview.playlist.track_count > spotifyPreview.tracks.length && (
                <div className="text-xs text-gray-600 text-center py-1">
                  + {spotifyPreview.playlist.track_count - spotifyPreview.tracks.length} more tracks
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result */}
        {spotifyResult && (
          <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-green-400 font-medium">
              <CheckCircle size={16} /> {spotifyResult.playlist_name}
            </div>
            <p className="text-sm text-gray-300">{spotifyResult.message}</p>
            <div className="flex gap-4 text-xs text-gray-400">
              <span>Total: {spotifyResult.total_tracks}</span>
              <span className="text-green-400">In library: {spotifyResult.in_library}</span>
              {spotifyResult.missing > 0 && (
                <span className="text-honey-400">Downloading: {spotifyResult.missing}</span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Running in background. The playlist will appear in Jellyfin and Symfonium when ready.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
