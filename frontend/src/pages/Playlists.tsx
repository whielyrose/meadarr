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

interface PlaylistDetails {
  id:              number
  name:            string
  description?:    string
  jellyfin_id?:    string
  auto_generated?: boolean
  track_count?:    number
  artist_count?:   number
  album_count?:    number
  tracks:          PlaylistTrackJF[]
}


/* ─── Drill-in view (separate component to avoid conditional hooks) ─── */
function PlaylistDetailView({
  playlistId, onBack,
}: {
  playlistId: number
  onBack:     () => void
}) {
  const cache = useDataCache()
  const cacheKey = `playlist:${playlistId}`
  const [playlist, setPlaylist] = useState<PlaylistDetails | null>(
    () => cache.get<PlaylistDetails>(cacheKey)?.data ?? null
  )
  const [loading, setLoading]   = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/playlists/${playlistId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PlaylistDetails = await res.json()
      setPlaylist(data)
      cache.set(cacheKey, data)
    } catch (e: any) {
      alert(`Failed to load playlist: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!cache.get(cacheKey)) load()
  }, [playlistId])

  const refresh = () => { cache.invalidate(cacheKey); load() }

  const albumsInPlaylist: AlbumTileItem[] = useMemo(() => {
    if (!playlist) return []
    const seen = new Map<string, AlbumTileItem>()
    playlist.tracks.forEach(t => {
      const key = `${t.artist}|${t.album}`.toLowerCase()
      if (!seen.has(key)) {
        seen.set(key, {
          artist:     t.artist,
          title:      t.album || t.title,
          in_library: true,
        })
      }
    })
    return Array.from(seen.values())
  }, [playlist])

  const uniqueArtists = useMemo(
    () => playlist ? new Set(playlist.tracks.map(t => t.artist)).size : 0,
    [playlist]
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-ghost p-2" title="Back to playlists">
            <ChevronLeft size={16} />
          </button>
          <div>
            <h1 className="page-title">{playlist?.name || 'Loading...'}</h1>
            <p className="page-subtitle">
              {playlist
                ? `${playlist.tracks.length} tracks · ${albumsInPlaylist.length} albums`
                : 'Loading playlist details...'}
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <button onClick={refresh} className="btn-ghost p-2" title="Refresh from Jellyfin" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !playlist ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">Loading tracks from Jellyfin...</p>
        </div>
      ) : !playlist || playlist.tracks.length === 0 ? (
        <div className="empty-state">
          <ListMusic className="empty-state-icon" size={52} />
          <p className="empty-state-title">Empty playlist</p>
          <p className="empty-state-text">
            This playlist has no tracks yet. Import songs to it or add them from Jellyfin.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="stat-card">
              <p className="stat-value">{playlist.tracks.length}</p>
              <p className="stat-label">Tracks</p>
            </div>
            <div className="stat-card">
              <p className="stat-value">{albumsInPlaylist.length}</p>
              <p className="stat-label">Albums</p>
            </div>
            <div className="stat-card">
              <p className="stat-value">{uniqueArtists}</p>
              <p className="stat-label">Artists</p>
            </div>
          </div>
          <PaginatedAlbumGrid items={albumsInPlaylist} viewMode={viewMode} />
        </>
      )}
    </div>
  )
}


/* ─── Main playlists list ─── */
export default function PlaylistsPage() {
  const cache = useDataCache()
  const [playlists, setPlaylists] = useState<PlaylistWithStats[]>(
    () => cache.get<PlaylistWithStats[]>('playlists:list')?.data ?? []
  )
  const [loading, setLoading]   = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newDesc, setNewDesc]   = useState('')
  const [syncing, setSyncing]   = useState<number | null>(null)
  const [feedback, setFeedback] = useState<Record<number, string>>({})
  const [openId, setOpenId]     = useState<number | null>(null)

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
      cache.invalidate(`playlist:${id}`); cache.invalidate('playlists:list'); load()
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [id]: `Failed: ${e.message}` }))
    } finally { setSyncing(null) }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await api.playlists.delete(id)
      cache.invalidate('playlists:list'); cache.invalidate(`playlist:${id}`); load()
    } catch (e: any) { alert(e.message) }
  }

  if (openId !== null) {
    return <PlaylistDetailView playlistId={openId} onBack={() => setOpenId(null)} />
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Playlists</h1>
          <p className="page-subtitle">Synced to Jellyfin and available in Symfonium</p>
        </div>
        <div className="flex gap-2 items-center">
          <button className="btn-ghost p-2"
            onClick={() => { cache.invalidate('playlists:list'); load() }}
            disabled={loading} title="Refresh">
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
            <div key={pl.id}
              className="card flex items-center gap-4 hover:border-accent-500/30 cursor-pointer transition-all"
              onClick={() => setOpenId(pl.id)}>
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
                  {!!pl.album_count && pl.album_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Disc3 size={11} /> {pl.album_count} albums
                    </span>
                  )}
                  {!!pl.artist_count && pl.artist_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Users size={11} /> {pl.artist_count} artists
                    </span>
                  )}
                </div>
                {pl.description && <p className="text-xs text-muted-500 mt-1 truncate">{pl.description}</p>}
                {feedback[pl.id] && (
                  <p className="text-xs text-accent-300 mt-0.5 flex items-center gap-1">
                    <CheckCircle size={11} /> {feedback[pl.id]}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
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
