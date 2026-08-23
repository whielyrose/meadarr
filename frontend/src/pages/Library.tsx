import { useState, useEffect, useCallback } from 'react'
import { Music, Search, RefreshCw, Disc3 } from 'lucide-react'
import { api, LibraryStats } from '../api'

// Hook: fetches album art from our backend (which uses Last.fm/CAA)
function useAlbumArt(artist: string, album: string, mbid?: string) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ artist, album })
    if (mbid) params.set('mbid', mbid)
    fetch(`/api/library/art?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.url) setUrl(d.url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [artist, album, mbid])

  return url
}

function AlbumCard({
  album, artist, onClick
}: {
  album: any
  artist: string
  onClick?: () => void
}) {
  const artUrl = useAlbumArt(artist, album.album, album.release_mbid)
  const [imgFailed, setImgFailed] = useState(false)

  return (
    <div
      className="group cursor-pointer"
      onClick={onClick}
      title={`${album.album}${album.year ? ` (${album.year})` : ''}`}
    >
      {/* Album art square */}
      <div className="relative aspect-square rounded-lg overflow-hidden mb-2 shadow-lg shadow-black/40 bg-surface-700 border border-surface-600">
        {artUrl && !imgFailed ? (
          <img
            src={artUrl}
            alt={album.album}
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="text-muted-600" size={32} />
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-2.5">
          <div>
            <p className="text-xs font-semibold text-white leading-tight line-clamp-2">{album.album}</p>
            <p className="text-xs text-white/60 mt-0.5">{album.track_count} tracks</p>
          </div>
        </div>
      </div>

      {/* Text below */}
      <p className="text-xs font-medium text-slate-300 truncate leading-tight">{album.album}</p>
      <p className="text-xs text-muted-500 mt-0.5">
        {album.year && <span>{album.year} · </span>}
        {album.format && <span className="text-accent-400">{album.format.toUpperCase()}</span>}
        {album.track_count && <span> · {album.track_count} tracks</span>}
      </p>
    </div>
  )
}

// Flatten all albums across all artists for grid display
function AllAlbumsGrid({ artists }: { artists: any[] }) {
  const [allAlbums, setAllAlbums] = useState<Array<{ artist: string; albums: any[] }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (artists.length === 0) return
    setLoading(true)

    // Load albums for all artists in parallel (batched to avoid overwhelming API)
    const batchSize = 10
    const results: Array<{ artist: string; albums: any[] }> = []

    const loadBatch = async (batch: typeof artists) => {
      await Promise.all(
        batch.map(async a => {
          try {
            const d = await api.library.artistAlbums(a.artist)
            results.push({ artist: a.artist, albums: d.albums })
          } catch {}
        })
      )
    }

    const loadAll = async () => {
      for (let i = 0; i < artists.length; i += batchSize) {
        await loadBatch(artists.slice(i, i + batchSize))
      }
      // Sort by artist name
      results.sort((a, b) => a.artist.localeCompare(b.artist))
      setAllAlbums(results)
      setLoading(false)
    }

    loadAll()
  }, [artists])

  if (loading) {
    return (
      <div className="empty-state">
        <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
        <p className="text-muted-500 text-sm">Loading albums...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {allAlbums.map(({ artist, albums }) => (
        <div key={artist}>
          {/* Artist section header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="w-7 h-7 bg-accent-500/10 rounded-full flex items-center justify-center border border-accent-500/20 shrink-0">
              <Music className="text-accent-400" size={12} />
            </div>
            <h3 className="font-semibold text-slate-200 text-sm">{artist}</h3>
            <span className="text-xs text-muted-600">{albums.length} album{albums.length !== 1 ? 's' : ''}</span>
            <div className="flex-1 h-px bg-surface-700" />
          </div>

          {/* Album grid — 3 cols mobile, 4 tablet, 5 desktop, 6 wide */}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
            {albums.map(album => (
              <AlbumCard key={album.album} album={album} artist={artist} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function LibraryPage() {
  const [stats, setStats]       = useState<LibraryStats | null>(null)
  const [artists, setArtists]   = useState<any[]>([])
  const [filtered, setFiltered] = useState<any[]>([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [scanning, setScanning] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [listAlbums, setListAlbums] = useState<Record<string, any[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)

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

  const toggleArtist = async (artist: string) => {
    if (expanded === artist) { setExpanded(null); return }
    setExpanded(artist)
    if (!listAlbums[artist]) {
      try {
        const d = await api.library.artistAlbums(artist)
        setListAlbums(prev => ({ ...prev, [artist]: d.albums }))
      } catch {}
    }
  }

  const triggerScan = async () => {
    setScanning(true)
    try { await api.library.scan(); setTimeout(() => { load(); setScanning(false) }, 3000) }
    catch { setScanning(false) }
  }

  const fmtSize = (gb: number) => gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="page-subtitle">
            {stats
              ? `${stats.total_artists} artists · ${stats.total_albums} albums · ${stats.total_tracks.toLocaleString()} tracks`
              : 'Your local music collection'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* View toggle */}
          <div className="flex bg-surface-800 rounded-lg border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('grid')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'grid' ? 'bg-accent-500/20 text-accent-200' : 'text-muted-400 hover:text-slate-300'
              }`}>
              Grid
            </button>
            <button onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'list' ? 'bg-accent-500/20 text-accent-200' : 'text-muted-400 hover:text-slate-300'
              }`}>
              List
            </button>
          </div>
          <button className="btn-secondary flex items-center gap-2" onClick={triggerScan} disabled={scanning}>
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { val: stats.total_tracks.toLocaleString(), label: 'Tracks' },
            { val: stats.total_artists.toLocaleString(), label: 'Artists' },
            { val: stats.total_albums.toLocaleString(), label: 'Albums' },
            { val: fmtSize(stats.total_size_gb), label: 'Size' },
          ].map(({ val, label }) => (
            <div key={label} className="stat-card">
              <p className="stat-value">{val}</p>
              <p className="stat-label">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Format pills */}
      {stats && Object.keys(stats.formats).length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          {Object.entries(stats.formats).map(([fmt, count]) => (
            <div key={fmt} className="flex items-center gap-2 bg-surface-800 rounded-lg px-3 py-1.5 border border-surface-700">
              <span className="badge badge-purple">{fmt.toUpperCase()}</span>
              <span className="text-xs text-muted-400">{(count as number).toLocaleString()} tracks</span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-500" size={13} />
        <input className="input pl-8" placeholder="Filter artists..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">Loading library...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Music className="empty-state-icon" size={52} />
          <p className="empty-state-title">{search ? `No artists matching "${search}"` : 'Library is empty'}</p>
          <p className="empty-state-text">{!search && 'Click Scan to index your music files'}</p>
        </div>
      ) : viewMode === 'grid' ? (
        <AllAlbumsGrid artists={filtered} />
      ) : (
        /* List view */
        <div className="space-y-1">
          {filtered.map(artist => (
            <div key={artist.artist}>
              <button
                className="w-full card text-left flex items-center gap-3 hover:border-accent-500/20 hover:bg-surface-700/50 transition-all"
                onClick={() => toggleArtist(artist.artist)}
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
                <RefreshCw
                  size={13}
                  className={`text-muted-500 transition-transform duration-200 ${expanded === artist.artist ? 'animate-spin' : ''}`}
                  style={{ display: expanded === artist.artist && !listAlbums[artist.artist] ? 'block' : 'none' }}
                />
              </button>

              {expanded === artist.artist && listAlbums[artist.artist] && (
                <div className="ml-6 mt-2 mb-2 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 animate-slide-in">
                  {listAlbums[artist.artist].map(album => (
                    <AlbumCard key={album.album} album={album} artist={artist.artist} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
