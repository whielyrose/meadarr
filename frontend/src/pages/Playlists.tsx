import { useState, useEffect } from 'react'
import { ListMusic, Plus, RefreshCw, Trash2, Send, CheckCircle } from 'lucide-react'
import { api, Playlist } from '../api'

export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading]     = useState(false)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [newDesc, setNewDesc]     = useState('')
  const [syncing, setSyncing]     = useState<number | null>(null)
  const [feedback, setFeedback]   = useState<Record<number, string>>({})

  const load = async () => {
    setLoading(true)
    try { const d = await api.playlists.list(); setPlaylists(d.playlists) }
    catch {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!newName.trim()) return
    try {
      await api.playlists.create(newName.trim(), newDesc.trim() || undefined)
      setNewName(''); setNewDesc(''); setCreating(false); load()
    } catch (e: any) { alert(e.message) }
  }

  const syncToJellyfin = async (id: number) => {
    setSyncing(id)
    try {
      const r: any = await api.playlists.syncToJellyfin(id)
      setFeedback(prev => ({ ...prev, [id]: `Synced ${r.tracks_synced} tracks` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [id]: `Failed: ${e.message}` }))
    } finally { setSyncing(null) }
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try { await api.playlists.delete(id); load() } catch (e: any) { alert(e.message) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Playlists</h1>
          <p className="page-subtitle">Synced to Jellyfin and available in Symfonium</p>
        </div>
        <button className="btn-primary flex items-center gap-1.5" onClick={() => setCreating(true)}>
          <Plus size={14} /> New Playlist
        </button>
      </div>

      {/* Create form */}
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

      {loading ? (
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
            <div key={pl.id} className="card flex items-center gap-4">
              {/* Icon */}
              <div className="w-10 h-10 bg-accent-500/10 rounded-lg flex items-center justify-center shrink-0 border border-accent-500/20">
                <ListMusic className="text-accent-400" size={18} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-100 truncate text-sm">{pl.name}</span>
                  {pl.jellyfin_id && <span className="badge badge-green">Jellyfin</span>}
                  {pl.auto_generated && <span className="badge badge-purple">Auto</span>}
                </div>
                <p className="text-xs text-muted-400 mt-0.5">
                  {pl.track_count || 0} tracks
                  {pl.description && ` · ${pl.description}`}
                </p>
                {feedback[pl.id] && (
                  <p className="text-xs text-accent-300 mt-0.5 flex items-center gap-1">
                    <CheckCircle size={11} /> {feedback[pl.id]}
                  </p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
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
