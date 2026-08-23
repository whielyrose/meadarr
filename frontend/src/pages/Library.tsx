import { useState, useEffect, useMemo } from 'react'
import {
  Music, Search, RefreshCw, Disc3, ChevronLeft, ChevronRight, LayoutGrid, List
} from 'lucide-react'
import { api, LibraryStats } from '../api'

const PAGE_SIZE = 25  // 5x5 grid

// Fetch album art from backend endpoint (cached, deduped)
function useAlbumArt(artist: string, album: string, mbid?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!artist || !album) return
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

function AlbumTile({ album, artist }: { album: any; artist: string }) {
  const artUrl = useAlbumArt(artist, album.album, album.release_mbid)
  const [failed, setFailed] = useState(false)

  return (
    <div className="group cursor-pointer" title={`${album.album}${album.year ? ` (${album.year})` : ''}`}>
      <div className="relative aspect-square rounded-lg overflow-hidden mb-2 shadow-lg shadow-black/40 bg-surface-700 border border-surface-600">
        {artUrl && !failed ? (
          <img src={artUrl} alt={album.album}
            className="w-full h-full object-cover"
            onError={() => setFailed(true)}
            loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="text-muted-600" size={32} />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end p-2.5">
          <div>
            <p className="text-xs font-semibold text-white leading-tight line-clamp-2">{album.album}</p>
            <p className="text-xs text-white/70 mt-0.5">{artist}</p>
            <p className="text-xs text-white/50 mt-0.5">{album.track_count} tracks</p>
          </div>
        </div>
      </div>
      <p className="text-xs font-medium text-slate-300 truncate leading-tight">{album.album}</p>
      <p className="text-xs text-muted-500 truncate">{artist}</p>
      <p className="text-xs text-muted-600 mt-0.5">
        {album.year && <span>{album.year}</span>}
        {album.format && <span className="text-accent-400 ml-1">{album.format.toUpperCase()}</span>}
      </p>
    </div>
  )
}

interface AlbumWithArtist {
  album: string
  artist: string
  year?: number
  track_count?: number
  format?: string
  release_mbid?: string
}

export default function LibraryPage() {
  const [stats, setStats]       = useState<LibraryStats | null>(null)
  const [artists, setArtists]   = useState<any[]>([])
  const [allAlbums, setAllAlbums] = useState<AlbumWithArtist[]>([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [scanning, setScanning] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [page, setPage]         = useState(0)
  const [loadingAlbums, setLoadingAlbums] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([api.library.stats(), api.library.artists()])
      setStats(s)
      setArtists(a.artists)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  // Load all albums across all artists (flattened)
  useEffect(() => {
    if (artists.length === 0) return
    let cancelled = false
    setLoadingAlbums(true)
    const all: AlbumWithArtist[] = []

    const loadAllAlbums = async () => {
      const batchSize = 10
      for (let i = 0; i < artists.length; i += batchSize) {
        if (cancelled) return
        const batch = artists.slice(i, i + batchSize)
        await Promise.all(batch.map(async a => {
          try {
            const d = await api.library.artistAlbums(a.artist)
            d.albums.forEach((album: any) => {
              all.push({ ...album, artist: a.artist })
            })
          } catch {}
        }))
      }
      if (cancelled) return
      // Sort by artist then album name
      all.sort((a, b) => {
        const artistCmp = a.artist.localeCompare(b.artist)
        if (artistCmp !== 0) return artistCmp
        return a.album.localeCompare(b.album)
      })
      setAllAlbums(all)
      setLoadingAlbums(false)
    }

    loadAllAlbums()
    return () => { cancelled = true }
  }, [artists])

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return allAlbums
    const q = search.toLowerCase()
    return allAlbums.filter(a =>
      a.artist.toLowerCase().includes(q) ||
      a.album.toLowerCase().includes(q)
    )
  }, [search, allAlbums])

  // Reset page when search changes
  useEffect(() => { setPage(0) }, [search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const triggerScan = async () => {
    setScanning(true)
    try {
      await api.library.scan()
      setTimeout(() => { load(); setScanning(false) }, 3000)
    } catch { setScanning(false) }
  }

  const fmtSize = (gb: number) => gb >= 1 ? `${gb.toFixed(1)} GB` : `${(gb * 1024).toFixed(0)} MB`

  return (
    <div className="p-6 max-w-7xl mx-auto">
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
          <div className="flex bg-surface-800 rounded-lg border border-surface-700 p-0.5">
            <button onClick={() => setViewMode('grid')}
              title="Grid view"
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'grid' ? 'bg-accent-500/20 text-accent-200' : 'text-muted-400 hover:text-slate-300'
              }`}>
              <LayoutGrid size={14} />
            </button>
            <button onClick={() => setViewMode('list')}
              title="List view"
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'list' ? 'bg-accent-500/20 text-accent-200' : 'text-muted-400 hover:text-slate-300'
              }`}>
              <List size={14} />
            </button>
          </div>
          <button className="btn-secondary flex items-center gap-2" onClick={triggerScan} disabled={scanning}>
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Scan'}
          </button>
        </div>
      </div>

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

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-500" size={13} />
        <input className="input pl-8" placeholder="Search artists or albums..." value={search}
          onChange={e => setSearch(e.target.value)} />
      </div>

      {loading || loadingAlbums ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">
            {loading ? 'Loading library...' : `Loading albums (${allAlbums.length} so far)...`}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Music className="empty-state-icon" size={52} />
          <p className="empty-state-title">
            {search ? `No results for "${search}"` : 'Library is empty'}
          </p>
          <p className="empty-state-text">
            {!search && 'Click Scan to index your music files'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <>
          {/* 5x5 grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mb-6 animate-slide-in">
            {currentPage.map((album, i) => (
              <AlbumTile key={`${album.artist}-${album.album}-${i}`}
                album={album} artist={album.artist} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-surface-700 pt-4">
              <p className="text-xs text-muted-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-slate-300 font-medium px-3">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* List view */}
          <div className="space-y-1 mb-6">
            {currentPage.map((album, i) => (
              <div key={`${album.artist}-${album.album}-${i}`}
                className="flex items-center gap-3 bg-surface-800 rounded-lg border border-surface-700 px-3 py-2 hover:border-accent-500/20 transition-all">
                <div className="w-10 h-10 rounded overflow-hidden shrink-0">
                  <AlbumTileSmall album={album} artist={album.artist} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-100 font-medium truncate">{album.album}</p>
                  <p className="text-xs text-muted-400 truncate">
                    {album.artist}
                    {album.year && ` · ${album.year}`}
                    {album.track_count && ` · ${album.track_count} tracks`}
                    {album.format && <span className="text-accent-400 ml-1">{album.format.toUpperCase()}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-surface-700 pt-4">
              <p className="text-xs text-muted-500">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft size={14} />
                </button>
                <span className="text-xs text-slate-300 font-medium px-3">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AlbumTileSmall({ album, artist }: { album: any; artist: string }) {
  const artUrl = useAlbumArt(artist, album.album, album.release_mbid)
  const [failed, setFailed] = useState(false)

  return artUrl && !failed ? (
    <img src={artUrl} alt={album.album}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
      loading="lazy" />
  ) : (
    <div className="w-full h-full bg-surface-700 flex items-center justify-center">
      <Disc3 className="text-muted-600" size={16} />
    </div>
  )
}
