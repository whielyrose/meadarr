import { useState, useEffect, useMemo } from 'react'
import {
  ListMusic, Plus, RefreshCw, Trash2, Send, CheckCircle,
  ChevronLeft, Users, Disc3,
} from 'lucide-react'
import { api, Playlist } from '../api'
import { useDataCache } from '../components/DataCache'
import { PaginatedAlbumGrid, ViewToggle, AlbumTileItem } from '../components/AlbumGrid'

interface PlaylistWithStats extends Playlist {
  track_count?:  number
  artist_count?: number
  album_count?:  number
}

interface PlaylistTrackJF {
  position:          number
  artist:            string
  album:             string
  title:             string
  jellyfin_item_id?: string
}

interface PlaylistDetails extends PlaylistWithStats {
  tracks: PlaylistTrackJF[]
}

export default function PlaylistsPage() {
  const cache = useDataCache()
  const [playlists, setPlaylists] = useState<PlaylistWithStats[]>(
    () => cache.get<PlaylistWithStats[]>('playlists:list')?.data ?? []
  )
  const [loading, setLoading]     = useState(false)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [newDesc, setNewDesc]     = useState('')
  const [syncing, setSyncing]     = useState<number | null>(null)
  const [feedback, setFeedback]   = useState<Record<number, string>>({})

  // Drill-in view
  const [openPlaylistId, setOpenPlaylistId] = useState<number | null>(null)
  const [openPlaylist, setOpenPlaylist]     = useState<PlaylistDetails | null>(null)
  const [loadingOpen, setLoadingOpen]       = useState(false)
  const [viewMode, setViewMode]             = useState<'grid' | 'list'>('grid')

  const load = async () => {
    setLoading(true)
    try {
      const d = await api.playlists.list()
      setPlaylists(d.playlists as PlaylistWithStats[])
      cache.set('playlists:list', d.playlists)
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => {
    if (!cache.get('playlists:list')) load()
  }, [])

  // Load a playlist's details when drill-in changes
  useEffect(() => {
    if (openPlaylistId === null) return
    const cacheKey = `playlist:${openPlaylistId}`
    const cached = cache.get<PlaylistDetails>(cacheKey)
    if (cached) { setOpenPlaylist(cached.data); return }

    setLoadingOpen(true)
    fetch(`/api/playlists/${openPlaylistId}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: PlaylistDetails) => {
        setOpenPlaylist(d)
        cache.set(cacheKey, d)
      })
      .catch(e => alert(`Failed to load playlist: ${e.message}`))
      .finally(() => setLoadingOpen(false))
  }, [openPlaylistId])

  const create = async () => {
    if (!newName.trim()) return
    try {
      await api.playlists.create(newName.trim(), newDesc.trim() || undefined)
      setNewName(''); setNewDesc(''); setCreating(false)
      cache.invalidate('playlists:list'); load()
    } catch (e: any) { alert(e.message) }
  }

  const syncToJellyfin = async (id: number) => {
    setSyncing(id)
    try {
      const r: any = await api.playlists.syncToJellyfin(id)
      setFeedback(prev => ({ ...prev, [id]: `Synced ${r.tracks_synced} tracks` }))
      cache.invalidate(`playlist:${id}`)
      cache.invalidate('playlists:list')
      load()
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [id]: `Failed: ${e.message}` }))
    } finally { setSyncing(null) }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await api.playlists.delete(id)
      cache.invalidate('playlists:list'); cache.invalidate(`playlist:${id}`)
      load()
    } catch (e: any) { alert(e.message) }
  }

  // === DRILL-IN VIEW ===
  if (openPlaylistId !== null) {
    // Deduplicate tracks by album for the grid (a playlist has many tracks per album)
    const albumsInPlaylist: AlbumTileItem[] = useMemo(() => {
      if (!openPlaylist) return []
      const seen = new Map<string, AlbumTileItem>()
      openPlaylist.tracks.forEach(t => {
        const key = `${t.artist}|${t.album}`.toLowerCase()
        if (!seen.has(key)) {
          seen.set(key, {
            artist: t.artist,
            title:  t.album || t.title,
            in_library: true,
          })
        }
      })
      return Array.from(seen.values())
    }, [openPlaylist])

    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setOpenPlaylistId(null); setOpenPlaylist(null) }}
              className="btn-ghost p-2"
              title="Back to playlists"
            >
              <ChevronLeft size={16} />
            </button>
            <div>
              <h1 className="page-title">{openPlaylist?.name || 'Loading...'}</h1>
              <p className="page-subtitle">
                {openPlaylist
                  ? `${openPlaylist.tracks.length} tracks · ${albumsInPlaylist.length} unique albums`
                  : 'Loading playlist details...'}
              </p>
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button
              onClick={() => { cache.invalidate(`playlist:${openPlaylistId}`); setOpenPlaylist(null); setOpenPlaylistId(openPlaylistId) }}
              className="btn-ghost p-2"
              title="Refresh from Jellyfin"
              disabled={loadingOpen}
            >
              <RefreshCw size={13} className={loadingOpen ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {loadingOpen ? (
          <div className="empty-state">
            <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
            <p className="text-muted-500 text-sm">Loading tracks from Jellyfin...</p>
          </div>
        ) : !openPlaylist || openPlaylist.tracks.length === 0 ? (
          <div className="empty-state">
            <ListMusic className="empty-state-icon" size={52} />
            <p className="empty-state-title">Empty playlist</p>
            <p className="empty-state-text">
              This playlist has no tracks yet. Import songs to it or add them from Jellyfin.
            </p>
          </div>
        ) : (
          <>
            {/* Stats */}
            {openPlaylist && (
              <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="stat-card">
                  <p className="stat-value">{openPlaylist.tracks.length}</p>
                  <p className="stat-label">Tracks</p>
                </div>
                <div className="stat-card">
                  <p className="stat-value">{albumsInPlaylist.length}</p>
                  <p className="stat-label">Albums</p>
                </div>
                <div className="stat-card">
                  <p className="stat-value">
                    {new Set(openPlaylist.tracks.map(t => t.artist)).size}
                  </p>
                  <p className="stat-label">Artists</p>
                </div>
              </div>
            )}

            <PaginatedAlbumGrid items={albumsInPlaylist} viewMode={viewMode} />
          </>
        )}
      </div>
    )
  }

  // === LIST VIEW (all playlists) ===
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Playlists</h1>
          <p className="page-subtitle">Synced to Jellyfin and available in Symfonium</p>
        </div>
        <div className="flex gap-2 items-center">
          <button
            className="btn-ghost p-2"
            onClick={() => { cache.invalidate('playlists:list'); load() }}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="btn-primary flex items-center gap-1.5" onClick={() => setCreating(true)}>
            <Plus size={14} /> New Playlist
          </button>
        </div>
      </div>

      {creating && (
        <div className="card mb-6 animate-slide-in space-y-3">
          <h3 className="font-semibold text-slate-200">New Playlist</h3>
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="My Playlist" value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()} autoFocus />
          </div>
          <div>
            <label className="label">Description <span className="text-muted-600">(optional)</span></label>
            <input className="input" placeholder="A great collection..." value={newDesc}
              onChange={e => setNewDesc(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={create}>Create</button>
            <button className="btn-secondary" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      {loading && playlists.length === 0 ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
        </div>
      ) : playlists.length === 0 ? (
        <div className="empty-state">
          <ListMusic className="empty-state-icon" size={52} />
          <p className="empty-state-title">No playlists yet</p>
          <p className="empty-state-text">Create a playlist or import one from Spotify or ListenBrainz</p>
        </div>
      ) : (
        <div className="space-y-2 animate-slide-in">
          {playlists.map(pl => (
            <div
              key={pl.id}
              className="card flex items-center gap-4 hover:border-accent-500/30 cursor-pointer transition-all"
              onClick={() => setOpenPlaylistId(pl.id)}
            >
              <div className="w-10 h-10 bg-accent-500/10 rounded-lg flex items-center justify-center shrink-0 border border-accent-500/20">
                <ListMusic className="text-accent-400" size={18} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-100 truncate text-sm">{pl.name}</span>
                  {pl.jellyfin_id && <span className="badge badge-green">Jellyfin</span>}
                  {pl.auto_generated && <span className="badge badge-purple">Auto</span>}
                </div>
                <div className="text-xs text-muted-400 flex items-center gap-3 mt-1">
                  <span className="flex items-center gap-1">
                    <ListMusic size={11} /> {pl.track_count ?? 0} tracks
                  </span>
                  {pl.album_count !== undefined && pl.album_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Disc3 size={11} /> {pl.album_count} albums
                    </span>
                  )}
                  {pl.artist_count !== undefined && pl.artist_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Users size={11} /> {pl.artist_count} artists
                    </span>
                  )}
                </div>
                {pl.description && (
                  <p className="text-xs text-muted-500 mt-1 truncate">{pl.description}</p>
                )}
                {feedback[pl.id] && (
                  <p className="text-xs text-accent-300 mt-0.5 flex items-center gap-1">
                    <CheckCircle size={11} /> {feedback[pl.id]}
                  </p>
                )}
              </div>

              <div
                className="flex items-center gap-1 shrink-0"
                onClick={e => e.stopPropagation()}
              >
                <button className="btn-ghost flex items-center gap-1.5 text-xs"
                  onClick={() => syncToJellyfin(pl.id)} disabled={syncing === pl.id}
                  title="Sync to Jellyfin">
                  <Send size={12} className={syncing === pl.id ? 'animate-pulse' : ''} />
                  Sync
                </button>
                <button className="btn-danger text-xs" onClick={() => del(pl.id, pl.name)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
