import { useState, useEffect, useRef } from 'react'
import { X, Play, Pause, Music2, Loader2, Volume2, VolumeX, Volume1 } from 'lucide-react'

interface PreviewTrack {
  position:    number
  title:       string
  duration_ms: number
  preview_url: string
}

interface PreviewData {
  found:  boolean
  tracks: PreviewTrack[]
  album:  string
  artist: string
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Single track row with play/pause button
function TrackRow({
  track, isPlaying, isLoading, onPlay,
}: {
  track:     PreviewTrack
  isPlaying: boolean
  isLoading: boolean
  onPlay:    () => void
}) {
  const hasPreview = !!track.preview_url

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
      isPlaying
        ? 'bg-accent-500/15 border border-accent-500/30'
        : 'hover:bg-surface-700/50 border border-transparent'
    }`}>
      <button
        onClick={onPlay}
        disabled={!hasPreview}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all ${
          hasPreview
            ? 'bg-accent-500 hover:bg-accent-400 text-white'
            : 'bg-surface-700 text-muted-600 cursor-not-allowed'
        }`}
        title={hasPreview ? (isPlaying ? 'Pause' : 'Play preview') : 'No preview available'}
      >
        {isLoading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : isPlaying ? (
          <Pause size={13} fill="currentColor" />
        ) : (
          <Play size={13} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      <span className="text-xs text-muted-500 w-6 text-center tabular-nums shrink-0">
        {track.position}
      </span>

      <span className={`flex-1 text-sm truncate ${
        isPlaying ? 'text-accent-200 font-medium' : 'text-slate-200'
      }`}>
        {track.title}
      </span>

      <span className="text-xs text-muted-500 tabular-nums shrink-0">
        {formatDuration(track.duration_ms)}
      </span>
    </div>
  )
}

// Modal that shows all tracks for an album with playable previews
export default function PreviewModal({
  artist, album, onClose,
}: {
  artist: string
  album:  string
  onClose: () => void
}) {
  const [data, setData]         = useState<PreviewData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [playing, setPlaying]   = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  // Volume 0..1. Persisted to localStorage so it carries between opens.
  const [volume, setVolume]     = useState<number>(() => {
    if (typeof window === 'undefined') return 0.7
    const v = localStorage.getItem('meadarr_preview_volume')
    return v !== null ? parseFloat(v) : 0.7
  })
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Fetch preview data
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ artist, album })
    fetch(`/api/library/previews?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d) setData(d)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [artist, album])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  // Sync volume changes to current audio and persist
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
    try { localStorage.setItem('meadarr_preview_volume', String(volume)) } catch {}
  }, [volume])

  // Handle ESC key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const play = (track: PreviewTrack) => {
    // Stop current if any
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    // If clicking the currently playing track, just stop
    if (playing === track.position) {
      setPlaying(null)
      setProgress(0)
      return
    }

    // Start new audio
    const audio = new Audio(track.preview_url)
    audio.volume = volume

    audio.addEventListener('timeupdate', () => {
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100)
    })
    audio.addEventListener('ended', () => {
      setPlaying(null)
      setProgress(0)
    })
    audio.addEventListener('error', () => {
      setPlaying(null)
      setProgress(0)
    })

    audio.play().catch(() => {
      setPlaying(null)
    })

    audioRef.current = audio
    setPlaying(track.position)
    setProgress(0)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-800 rounded-xl border border-surface-700 shadow-2xl max-w-md w-full max-h-[85vh] flex flex-col animate-slide-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b border-surface-700">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-accent-400 uppercase tracking-wider mb-1 font-medium">
              Preview
            </p>
            <h2 className="text-lg font-bold text-slate-100 truncate leading-tight">
              {data?.album || album}
            </h2>
            <p className="text-sm text-muted-400 truncate">
              {data?.artist || artist}
            </p>
          </div>
          <button
            onClick={onClose}
            className="btn-ghost p-2 shrink-0"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Now playing progress bar */}
        {playing !== null && (
          <div className="px-4 pt-3">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="empty-state py-12">
              <Loader2 className="animate-spin text-accent-400 mb-3" size={28} />
              <p className="text-muted-500 text-sm">Fetching previews from Deezer...</p>
            </div>
          ) : !data?.found || data.tracks.length === 0 ? (
            <div className="empty-state py-12">
              <Music2 className="empty-state-icon" size={40} />
              <p className="empty-state-title">No previews available</p>
              <p className="empty-state-text">
                Deezer doesn't have this album, or the artist/album name doesn't match exactly.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {data.tracks.map(track => (
                <TrackRow
                  key={track.position}
                  track={track}
                  isPlaying={playing === track.position}
                  isLoading={false}
                  onPlay={() => play(track)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer with volume */}
        <div className="p-3 border-t border-surface-700 space-y-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setVolume(volume > 0 ? 0 : 0.7)}
              className="text-muted-400 hover:text-slate-200 transition-colors shrink-0"
              title={volume > 0 ? 'Mute' : 'Unmute'}
            >
              {volume === 0 ? <VolumeX size={16} /> :
               volume < 0.5 ? <Volume1 size={16} /> :
               <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={e => setVolume(parseFloat(e.target.value))}
              className="flex-1 h-1 appearance-none cursor-pointer bg-surface-700 rounded-full accent-accent-500
                         [&::-webkit-slider-thumb]:appearance-none
                         [&::-webkit-slider-thumb]:w-3
                         [&::-webkit-slider-thumb]:h-3
                         [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-accent-500
                         [&::-webkit-slider-thumb]:cursor-pointer
                         [&::-webkit-slider-thumb]:shadow-lg
                         [&::-moz-range-thumb]:w-3
                         [&::-moz-range-thumb]:h-3
                         [&::-moz-range-thumb]:rounded-full
                         [&::-moz-range-thumb]:bg-accent-500
                         [&::-moz-range-thumb]:border-0
                         [&::-moz-range-thumb]:cursor-pointer"
              style={{
                background: `linear-gradient(to right, rgb(109 99 255) 0%, rgb(109 99 255) ${volume * 100}%, rgb(36 40 56) ${volume * 100}%, rgb(36 40 56) 100%)`
              }}
            />
            <span className="text-xs text-muted-500 w-8 text-right tabular-nums shrink-0">
              {Math.round(volume * 100)}
            </span>
          </div>
          <p className="text-xs text-muted-600 text-center">
            30-second previews · powered by <span className="text-muted-400">Deezer</span>
          </p>
        </div>
      </div>
    </div>
  )
}
