import { useState, useEffect } from 'react'
import { Music2, RefreshCw, Download, CheckCircle, Sparkles, List, AlertCircle } from 'lucide-react'

interface PreviewResult {
  status: 'preview'
  playlist_name: string
  total_tracks: number
  in_library: number
  missing: number
  tracks: Array<{ artist: string; title: string; in_library: boolean; album?: string }>
  message: string
}

interface ImportResult {
  status: 'processing'
  playlist_name: string
  total_tracks: number
  in_library: number
  missing: number
  message: string
}

type LBResult = PreviewResult | ImportResult | null
type SpotifyResult = PreviewResult | ImportResult | null

interface LBPlaylist {
  title: string
  mbid: string
  date: string
}

type LBPlaylistType = 'weekly-jams' | 'weekly-exploration'

function TrackList({ tracks }: { tracks: PreviewResult['tracks'] }) {
  return (
    <div className="space-y-1 max-h-56 overflow-y-auto rounded-lg border border-gray-800">
      {tracks.map((track, i) => (
        <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-3 border-b border-gray-800 last:border-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${track.in_library ? 'bg-green-500' : 'bg-gray-600'}`} />
          <span className="text-gray-200 truncate flex-1">{track.title}</span>
          <span className="text-gray-500 truncate max-w-24">{track.artist}</span>
          {track.in_library
            ? <span className="text-green-500 shrink-0 text-xs">✓ Have it</span>
            : <span className="text-honey-400 shrink-0 text-xs">↓ Missing</span>
          }
        </div>
      ))}
    </div>
  )
}

function PreviewCard({
  result,
  onConfirm,
  onCancel,
  confirming,
  showDownloadToggle,
  downloadMissing,
  onToggleDownload,
}: {
  result: PreviewResult
  onConfirm: () => void
  onCancel: () => void
  confirming: boolean
  showDownloadToggle: boolean
  downloadMissing: boolean
  onToggleDownload: (v: boolean) => void
}) {
  return (
    <div className="space-y-3">
      <div className="bg-gray-800/60 rounded-lg p-3 space-y-2">
        <div className="font-medium text-gray-200">{result.playlist_name}</div>
        <div className="flex gap-4 text-xs">
          <span className="text-gray-400">{result.total_tracks} tracks total</span>
          <span className="text-green-400">{result.in_library} in library</span>
          <span className={result.missing > 0 ? 'text-honey-400' : 'text-gray-500'}>
            {result.missing} missing
          </span>
        </div>
      </div>

      {result.tracks && result.tracks.length > 0 && (
        <TrackList tracks={result.tracks} />
      )}

      {showDownloadToggle && result.missing > 0 && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={downloadMissing}
            onChange={e => onToggleDownload(e.target.checked)}
            className="w-4 h-4 accent-honey-500" />
          <span className="text-sm text-gray-300">
            Download {result.missing} missing track{result.missing !== 1 ? 's' : ''} via slskd
          </span>
        </label>
      )}

      <div className="flex gap-2">
        <button className="btn-primary flex items-center gap-2" onClick={onConfirm} disabled={confirming}>
          <CheckCircle size={14} />
          {confirming ? 'Starting...' : result.missing > 0 && downloadMissing
            ? `Confirm & Download ${result.missing} missing`
            : 'Confirm & Create Playlist'}
        </button>
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function ProcessingCard({ result }: { result: ImportResult }) {
  return (
    <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 space-y-2">
      <div className="flex items-center gap-2 text-green-400 font-medium">
        <CheckCircle size={16} />{result.playlist_name}
      </div>
      <p className="text-sm text-gray-300">{result.message}</p>
      <div className="flex gap-4 text-xs text-gray-400">
        <span>Total: {result.total_tracks}</span>
        <span className="text-green-400">In library: {result.in_library}</span>
        {result.missing > 0 && <span className="text-honey-400">Downloading: {result.missing}</span>}
      </div>
      <p className="text-xs text-gray-500">
        Playlist will appear in Jellyfin and Symfonium when ready.
        {result.missing > 0 && ' Downloads running in background — check the Queue page.'}
      </p>
    </div>
  )
}

export default function ImportsPage() {
  const [lbPlaylists, setLbPlaylists]     = useState<LBPlaylist[]>([])
  const [lbSelected, setLbSelected]       = useState<LBPlaylistType>('weekly-jams')
  const [lbLoading, setLbLoading]         = useState(false)
  const [lbResult, setLbResult]           = useState<LBResult>(null)
  const [lbError, setLbError]             = useState<string | null>(null)
  const [lbConfirming, setLbConfirming]   = useState(false)
  const [lbDownload, setLbDownload]       = useState(true)

  const [spotifyUrl, setSpotifyUrl]           = useState('')
  const [spotifyFormat, setSpotifyFormat]     = useState<'mp3' | 'flac'>('mp3')
  const [spotifyDownload, setSpotifyDownload] = useState(true)
  const [spotifyLoading, setSpotifyLoading]   = useState(false)
  const [spotifyResult, setSpotifyResult]     = useState<SpotifyResult>(null)
  const [spotifyError, setSpotifyError]       = useState<string | null>(null)
  const [spotifyConfirming, setSpotifyConfirming] = useState(false)

  useEffect(() => {
    fetch('/api/imports/listenbrainz/playlists')
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setLbPlaylists(d.playlists || []))
      .catch(() => {})
  }, [])

  // Step 1: Preview LB playlist
  const previewLB = async () => {
    setLbLoading(true)
    setLbResult(null)
    setLbError(null)
    try {
      const res = await fetch(`/api/imports/listenbrainz/${lbSelected}?confirmed=false`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setLbResult(data)
    } catch (e: any) {
      setLbError(e.message)
    } finally {
      setLbLoading(false)
    }
  }

  // Step 2: Confirm LB import
  const confirmLB = async () => {
    setLbConfirming(true)
    try {
      const res = await fetch(
        `/api/imports/listenbrainz/${lbSelected}?confirmed=true&format_pref=mp3`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setLbResult(data)
    } catch (e: any) {
      setLbError(e.message)
      setLbResult(null)
    } finally {
      setLbConfirming(false)
    }
  }

  // Step 1: Preview Spotify playlist
  const previewSpotify = async () => {
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
          confirmed: false,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setSpotifyResult(data)
    } catch (e: any) {
      setSpotifyError(e.message)
    } finally {
      setSpotifyLoading(false)
    }
  }

  // Step 2: Confirm Spotify import
  const confirmSpotify = async () => {
    setSpotifyConfirming(true)
    try {
      const res = await fetch('/api/imports/spotify/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: spotifyUrl,
          format_pref: spotifyFormat,
          download_missing: spotifyDownload,
          confirmed: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setSpotifyResult(data)
    } catch (e: any) {
      setSpotifyError(e.message)
      setSpotifyResult(null)
    } finally {
      setSpotifyConfirming(false)
    }
  }

  const isLBPreview    = lbResult?.status === 'preview'
  const isLBProcessing = lbResult?.status === 'processing'
  const isSpPreview    = spotifyResult?.status === 'preview'
  const isSpProcessing = spotifyResult?.status === 'processing'

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">Import Playlists</h1>

      {/* ── ListenBrainz ──────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="text-honey-400" size={18} />
          <div>
            <h2 className="font-semibold text-gray-200">ListenBrainz Playlists</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Import playlists generated by ListenBrainz based on your listening history.
              Requires following{' '}
              <a href="https://listenbrainz.org/user/troi-bot/" target="_blank" rel="noreferrer"
                className="text-honey-400 hover:underline">troi-bot</a>.
              Playlists generate Monday mornings.
            </p>
          </div>
        </div>

        {lbPlaylists.length > 0 && (
          <div className="bg-gray-800/40 rounded-lg p-3 space-y-1">
            <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
              <List size={11} />Available on your account:
            </div>
            {lbPlaylists.map((pl, i) => (
              <div key={i} className="text-xs text-gray-300 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                <span>{pl.title}</span>
                {pl.date && <span className="text-gray-600 ml-auto">{pl.date.slice(0, 10)}</span>}
              </div>
            ))}
          </div>
        )}

        {isLBProcessing ? (
          <>
            <ProcessingCard result={lbResult as ImportResult} />
            <button className="btn-secondary text-xs" onClick={() => { setLbResult(null); setLbError(null) }}>
              Import Another
            </button>
          </>
        ) : isLBPreview ? (
          <PreviewCard
            result={lbResult as PreviewResult}
            onConfirm={confirmLB}
            onCancel={() => setLbResult(null)}
            confirming={lbConfirming}
            showDownloadToggle={lbSelected === 'weekly-exploration'}
            downloadMissing={lbDownload}
            onToggleDownload={setLbDownload}
          />
        ) : (
          <>
            {lbError && (
              <div className="bg-red-900/20 border border-red-800 text-red-300 rounded-lg p-3 text-sm flex gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>{lbError}</div>
              </div>
            )}
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="label">Playlist</label>
                <select className="input" value={lbSelected}
                  onChange={e => { setLbSelected(e.target.value as LBPlaylistType); setLbResult(null) }}>
                  <option value="weekly-jams">Weekly Jams (familiar songs)</option>
                  <option value="weekly-exploration">Weekly Exploration (new discoveries)</option>
                </select>
              </div>
              <button className="btn-primary flex items-center gap-2 shrink-0"
                onClick={previewLB} disabled={lbLoading}>
                <RefreshCw size={14} className={lbLoading ? 'animate-spin' : ''} />
                {lbLoading ? 'Loading...' : 'Preview'}
              </button>
            </div>
            <div className="text-xs text-gray-600 space-y-0.5">
              <p>• <strong className="text-gray-500">Weekly Jams</strong> — songs from your listening history. Creates playlist from existing library.</p>
              <p>• <strong className="text-gray-500">Weekly Exploration</strong> — new music you might like. Missing tracks will be downloaded.</p>
            </div>
          </>
        )}
      </div>

      {/* ── Spotify ───────────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Music2 className="text-green-400" size={18} />
          <div>
            <h2 className="font-semibold text-gray-200">Spotify Playlist</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Paste any public Spotify playlist URL. Requires Spotify credentials in Settings.
            </p>
          </div>
        </div>

        {isSpProcessing ? (
          <>
            <ProcessingCard result={spotifyResult as ImportResult} />
            <button className="btn-secondary text-xs"
              onClick={() => { setSpotifyResult(null); setSpotifyUrl(''); setSpotifyError(null) }}>
              Import Another
            </button>
          </>
        ) : isSpPreview ? (
          <PreviewCard
            result={spotifyResult as PreviewResult}
            onConfirm={confirmSpotify}
            onCancel={() => setSpotifyResult(null)}
            confirming={spotifyConfirming}
            showDownloadToggle={true}
            downloadMissing={spotifyDownload}
            onToggleDownload={setSpotifyDownload}
          />
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label className="label">Spotify Playlist URL</label>
                <input className="input" placeholder="https://open.spotify.com/playlist/..."
                  value={spotifyUrl}
                  onChange={e => { setSpotifyUrl(e.target.value); setSpotifyResult(null); setSpotifyError(null) }} />
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
              <button className="btn-primary flex items-center gap-2"
                onClick={previewSpotify} disabled={!spotifyUrl.trim() || spotifyLoading}>
                <RefreshCw size={14} className={spotifyLoading ? 'animate-spin' : ''} />
                {spotifyLoading ? 'Fetching playlist...' : 'Preview Playlist'}
              </button>
            </div>

            {spotifyError && (
              <div className="bg-red-900/20 border border-red-800 text-red-300 rounded-lg p-3 text-sm flex gap-2">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <div>
                  {spotifyError}
                  {spotifyError.includes('configured') && (
                    <span className="block mt-1 text-xs">
                      Go to Settings and add your Spotify Client ID and Secret.
                    </span>
                  )}
                  {spotifyError.includes('private') && (
                    <span className="block mt-1 text-xs">
                      Make sure the playlist is set to public in Spotify.
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
