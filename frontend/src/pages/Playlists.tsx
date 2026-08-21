import { useState, useEffect } from 'react'
import { ListMusic, Plus, RefreshCw, Trash2, Music2, Send } from 'lucide-react'
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
    try {
      const data = await api.playlists.list()
      setPlaylists(data.playlists)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!newName.trim()) return
    try {
      await api.playlists.create(newName.trim(), newDesc.trim() || undefined)
      setNewName('')
      setNewDesc('')
      setCreating(false)
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const syncToJellyfin = async (id: number) => {
    setSyncing(id)
    try {
      const result: any = await api.playlists.syncToJellyfin(id)
      setFeedback(prev => ({ ...prev, [id]: `✅ Synced ${result.tracks_synced} tracks` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [id]: `❌ ${e.message}` }))
    } finally {
      setSyncing(null)
    }
  }

  const deletePlaylist = async (id: number, name: string) => {
    if (!confirm(`Delete playlist "${name}"?`)) return
    try {
      await api.playlists.delete(id)
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Playlists</h1>
        <button
          className="btn-primary flex items-center gap-1"
          onClick={() => setCreating(true)}
        >
          <Plus size={14} />
          New Playlist
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="card mb-4 space-y-3">
          <h3 className="font-medium text-gray-200">New Playlist</h3>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              placeholder="My Playlist"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && create()}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <input
              className="input"
              placeholder="A great collection..."
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={create}>
              Create
            </button>
            <button className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">
          <RefreshCw className="animate-spin mx-auto mb-3" size={32} />
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-16 text-gray-600">
          <ListMusic size={48} className="mx-auto mb-3 opacity-30" />
          <p>No playlists yet</p>
          <p className="text-sm mt-1">Create a playlist to get started</p>
        </div>
      ) : (
        <div className="space-y-2">
          {playlists.map(pl => (
            <div key={pl.id} className="card flex items-center gap-4">
              <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                <ListMusic className="text-gray-600" size={18} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-100 truncate">{pl.name}</span>
                  {pl.jellyfin_id && (
                    <span className="badge badge-green text-xs">Jellyfin</span>
                  )}
                  {pl.auto_generated ? (
                    <span className="badge badge-blue text-xs">Auto</span>
                  ) : null}
                </div>
                <div className="text-xs text-gray-500">
                  {pl.track_count || 0} tracks
                  {pl.description && ` · ${pl.description}`}
                </div>
                {feedback[pl.id] && (
                  <div className="text-xs mt-0.5 text-gray-400">{feedback[pl.id]}</div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="btn-ghost flex items-center gap-1 text-xs"
                  onClick={() => syncToJellyfin(pl.id)}
                  disabled={syncing === pl.id}
                  title="Sync to Jellyfin"
                >
                  <Send size={12} className={syncing === pl.id ? 'animate-pulse' : ''} />
                  Sync
                </button>
                <button
                  className="btn-ghost flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                  onClick={() => deletePlaylist(pl.id, pl.name)}
                  title="Delete playlist"
                >
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
