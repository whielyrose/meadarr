import { useState, useEffect } from 'react'
import { Music, Search, RefreshCw, ChevronDown, Disc3, HardDrive } from 'lucide-react'
import { api, LibraryStats, LibraryArtist } from '../api'

export default function LibraryPage() {
  const [stats, setStats]       = useState<LibraryStats | null>(null)
  const [artists, setArtists]   = useState<LibraryArtist[]>([])
  const [filtered, setFiltered] = useState<LibraryArtist[]>([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [scanning, setScanning] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [albums, setAlbums]     = useState<any[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([api.library.stats(), api.library.artists()])
      setStats(s)
      setArtists(a.artists)
      setFiltered(a.artists)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const q = search.toLowerCase()
    setFiltered(q ? artists.filter(a => a.artist.toLowerCase().includes(q)) : artists)
  }, [search, artists])

  const selectArtist = async (artist: string) => {
    if (selected === artist) { setSelected(null); setAlbums([]); return }
    setSelected(artist)
    try {
      const d = await api.library.artistAlbums(artist)
      setAlbums(d.albums)
    } catch {}
  }

  const triggerScan = async () => {
    setScanning(true)
    try { await api.library.scan(); setTimeout(() => { load(); setScanning(false) }, 3000) }
    catch { setScanning(false) }
  }

  const fmtSize = (gb: number) => gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">
            {stats ? `${stats.total_artists} artists · ${stats.total_albums} albums · ${stats.total_tracks.toLocaleString()} tracks` : 'Your local music collection'}
          </p>
        </div>
        <button className="btn-secondary flex items-center gap-2" onClick={triggerScan} disabled={scanning}>
          <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning...' : 'Scan Library'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="stat-card">
            <p className="stat-value">{stats.total_tracks.toLocaleString()}</p>
            <p className="stat-label">Tracks</p>
          </div>
          <div className="stat-card">
            <p className="stat-value">{stats.total_artists.toLocaleString()}</p>
            <p className="stat-label">Artists</p>
          </div>
          <div className="stat-card">
            <p className="stat-value">{stats.total_albums.toLocaleString()}</p>
            <p className="stat-label">Albums</p>
          </div>
          <div className="stat-card">
            <p className="stat-value">{fmtSize(stats.total_size_gb)}</p>
            <p className="stat-label">Total Size</p>
          </div>
        </div>
      )}

      {/* Format pills */}
      {stats && Object.keys(stats.formats).length > 0 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {Object.entries(stats.formats).map(([fmt, count]) => (
            <div key={fmt} className="flex items-center gap-2 bg-surface-800 rounded-lg px-3 py-1.5 border border-surface-700">
              <span className="badge badge-purple">{fmt.toUpperCase()}</span>
              <span className="text-xs text-muted-400">{count.toLocaleString()} tracks</span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-500" size={13} />
        <input className="input pl-8" placeholder="Filter artists..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Artist list */}
      {loading ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">Loading library...</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(artist => (
            <div key={artist.artist}>
              <button
                className="w-full card text-left flex items-center gap-3 hover:border-accent-500/20 hover:bg-surface-700/50 transition-all"
                onClick={() => selectArtist(artist.artist)}
              >
                <div className="w-9 h-9 bg-surface-700 rounded-lg flex items-center justify-center shrink-0 border border-surface-600">
                  <Music className="text-muted-500" size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-100 text-sm truncate">{artist.artist}</p>
                  <p className="text-xs text-muted-400">
                    {artist.album_count} album{artist.album_count !== 1 ? 's' : ''} · {artist.track_count} tracks
                    {artist.formats && <span className="text-accent-400 ml-1">{artist.formats.toUpperCase()}</span>}
                  </p>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-muted-500 transition-transform duration-200 ${selected === artist.artist ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Albums */}
              {selected === artist.artist && albums.length > 0 && (
                <div className="ml-6 mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-1.5 animate-slide-in">
                  {albums.map(album => (
                    <div key={album.album}
                      className="flex items-center gap-3 bg-surface-700/50 rounded-lg px-3 py-2.5 border border-surface-700">
                      <div className="w-8 h-8 bg-surface-700 rounded flex items-center justify-center shrink-0">
                        <Disc3 className="text-muted-600" size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-200 font-medium truncate">{album.album}</p>
                        <p className="text-xs text-muted-500">
                          {album.year && `${album.year} · `}
                          {album.track_count} tracks
                          {album.format && <span className="text-accent-400 ml-1">{album.format.toUpperCase()}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="empty-state">
              <Music className="empty-state-icon" size={52} />
              <p className="empty-state-title">{search ? `No artists matching "${search}"` : 'Library is empty'}</p>
              <p className="empty-state-text">
                {!search && 'Click "Scan Library" to index your music files'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
