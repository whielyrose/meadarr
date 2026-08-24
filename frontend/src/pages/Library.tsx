import { useState, useEffect, useMemo } from 'react'
import { Music, Search, RefreshCw } from 'lucide-react'
import { api, LibraryStats } from '../api'
import { PaginatedAlbumGrid, ViewToggle, AlbumTileItem } from '../components/AlbumGrid'
import { useDataCache } from '../components/DataCache'

export default function LibraryPage() {
  const cache = useDataCache()
  const [stats, setStats]       = useState<LibraryStats | null>(
    () => cache.get<LibraryStats>('library:stats')?.data ?? null
  )
  const [artists, setArtists]   = useState<any[]>(
    () => cache.get<any[]>('library:artists')?.data ?? []
  )
  const [allAlbums, setAllAlbums] = useState<AlbumTileItem[]>(
    () => cache.get<AlbumTileItem[]>('library:allAlbums')?.data ?? []
  )
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [scanning, setScanning] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [loadingAlbums, setLoadingAlbums] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([api.library.stats(), api.library.artists()])
      setStats(s)
      setArtists(a.artists)
      cache.set('library:stats', s)
      cache.set('library:artists', a.artists)
    } catch {}
    finally { setLoading(false) }
  }

  useEffect(() => {
    // Only fetch if we don't have cached data yet
    if (!cache.get('library:stats') || !cache.get('library:artists')) {
      load()
    }
  }, [])

  // Load all albums across all artists in a flat list
  useEffect(() => {
    if (artists.length === 0) return
    // Skip fetch if we already have cached albums matching current artist count
    const cached = cache.get<AlbumTileItem[]>('library:allAlbums')
    if (cached?.data && cached.data.length > 0 && allAlbums.length > 0) return

    let cancelled = false
    setLoadingAlbums(true)
    const all: AlbumTileItem[] = []

    const loadAllAlbums = async () => {
      const batchSize = 10
      for (let i = 0; i < artists.length; i += batchSize) {
        if (cancelled) return
        const batch = artists.slice(i, i + batchSize)
        await Promise.all(batch.map(async a => {
          try {
            const d = await api.library.artistAlbums(a.artist)
            d.albums.forEach((album: any) => {
              all.push({
                artist:     a.artist,
                title:      album.album,
                year:       album.year,
                mbid:       album.release_mbid,
                in_library: true,
                library_quality: album.format,
                extra:      `${album.track_count} tracks`,
              })
            })
          } catch {}
        }))
      }
      if (cancelled) return
      all.sort((a, b) => {
        const artistCmp = a.artist.localeCompare(b.artist)
        if (artistCmp !== 0) return artistCmp
        return a.title.localeCompare(b.title)
      })
      setAllAlbums(all)
      cache.set('library:allAlbums', all)
      setLoadingAlbums(false)
    }

    loadAllAlbums()
    return () => { cancelled = true }
  }, [artists])

  const filtered = useMemo(() => {
    if (!search) return allAlbums
    const q = search.toLowerCase()
    return allAlbums.filter(a =>
      a.artist.toLowerCase().includes(q) ||
      a.title.toLowerCase().includes(q)
    )
  }, [search, allAlbums])

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
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <button
            className="btn-ghost flex items-center gap-2 text-xs"
            onClick={() => {
              cache.invalidate('library:stats')
              cache.invalidate('library:artists')
              cache.invalidate('library:allAlbums')
              load()
            }}
            disabled={loading || loadingAlbums}
            title="Refresh from cache"
          >
            <RefreshCw size={13} className={loading || loadingAlbums ? 'animate-spin' : ''} />
          </button>
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
      ) : (
        <PaginatedAlbumGrid
          items={filtered}
          viewMode={viewMode}
        />
      )}
    </div>
  )
}
