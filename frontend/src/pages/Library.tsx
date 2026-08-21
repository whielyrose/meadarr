import { useState, useEffect } from 'react'
import { Music, Search, RefreshCw, ChevronRight, Disc3 } from 'lucide-react'
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
      const [s, a] = await Promise.all([
        api.library.stats(),
        api.library.artists(),
      ])
      setStats(s)
      setArtists(a.artists)
      setFiltered(a.artists)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!search) {
      setFiltered(artists)
    } else {
      const q = search.toLowerCase()
      setFiltered(artists.filter(a => a.artist.toLowerCase().includes(q)))
    }
  }, [search, artists])

  const selectArtist = async (artist: string) => {
    if (selected === artist) {
      setSelected(null)
      setAlbums([])
      return
    }
    setSelected(artist)
    try {
      const data = await api.library.artistAlbums(artist)
      setAlbums(data.albums)
    } catch (e) {}
  }

  const triggerScan = async () => {
    setScanning(true)
    try {
      await api.library.scan()
      setTimeout(() => { load(); setScanning(false) }, 3000)
    } catch (e) {
      setScanning(false)
    }
  }

  const formatSize = (gb: number) => gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Library</h1>
        <button
          className="btn-secondary flex items-center gap-1"
          onClick={triggerScan}
          disabled={scanning}
        >
          <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
          {scanning ? 'Scanning...' : 'Scan Library'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Tracks',  value: stats.total_tracks.toLocaleString() },
            { label: 'Artists', value: stats.total_artists.toLocaleString() },
            { label: 'Albums',  value: stats.total_albums.toLocaleString() },
            { label: 'Size',    value: formatSize(stats.total_size_gb) },
          ].map(({ label, value }) => (
            <div key={label} className="card text-center">
              <div className="text-xl font-bold text-honey-400">{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Format breakdown */}
      {stats && Object.keys(stats.formats).length > 0 && (
        <div className="card mb-6 flex gap-4 flex-wrap">
          {Object.entries(stats.formats).map(([fmt, count]) => (
            <div key={fmt} className="flex items-center gap-2">
              <span className="badge badge-gray">{fmt.toUpperCase()}</span>
              <span className="text-sm text-gray-400">{count} tracks</span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
        <input
          className="input pl-8"
          placeholder="Filter artists..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Artist list */}
      {loading ? (
        <div className="text-center py-16 text-gray-500">
          <RefreshCw className="animate-spin mx-auto mb-3" size={32} />
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(artist => (
            <div key={artist.artist}>
              <button
                className="w-full card text-left flex items-center gap-4 hover:border-gray-700 transition-colors"
                onClick={() => selectArtist(artist.artist)}
              >
                <div className="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                  <Music className="text-gray-600" size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-100 truncate">{artist.artist}</div>
                  <div className="text-xs text-gray-500">
                    {artist.album_count} albums · {artist.track_count} tracks
                    {artist.formats && ` · ${artist.formats.toUpperCase()}`}
                  </div>
                </div>
                <ChevronRight
                  size={16}
                  className={`text-gray-600 transition-transform ${selected === artist.artist ? 'rotate-90' : ''}`}
                />
              </button>

              {/* Albums (expanded) */}
              {selected === artist.artist && albums.length > 0 && (
                <div className="ml-8 mt-1 space-y-1">
                  {albums.map(album => (
                    <div key={album.album} className="card flex items-center gap-3 py-3">
                      <Disc3 className="text-gray-700 shrink-0" size={16} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-200 truncate">{album.album}</div>
                        <div className="text-xs text-gray-500">
                          {album.year && `${album.year} · `}
                          {album.track_count} tracks
                          {album.format && ` · ${album.format.toUpperCase()}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-600">
              <Music size={40} className="mx-auto mb-3 opacity-30" />
              <p>{search ? `No artists matching "${search}"` : 'Library is empty'}</p>
              {!search && (
                <p className="text-sm mt-1">Click "Scan Library" to index your music files</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
