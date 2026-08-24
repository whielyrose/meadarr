import { useState, useCallback } from 'react'
import { Search } from 'lucide-react'
import { api, Release } from '../api'
import { PaginatedAlbumGrid, ViewToggle, AlbumTileItem } from '../components/AlbumGrid'
import { useDataCache } from '../components/DataCache'

export default function SearchPage() {
  const cache = useDataCache()
  const [query, setQuery]     = useState(
    () => cache.get<string>('search:query')?.data ?? ''
  )
  const [results, setResults] = useState<Release[]>(
    () => cache.get<Release[]>('search:results')?.data ?? []
  )
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback]   = useState<Record<string, string>>({})
  const [formatPref, setFormatPref] = useState<'mp3' | 'flac'>('mp3')
  const [viewMode, setViewMode]     = useState<'grid' | 'list'>('grid')

  const doSearch = useCallback(async () => {
    if (query.trim().length < 2) return
    setLoading(true); setError(null)
    try {
      const data = await api.search.releases(query.trim(), 100)
      setResults(data.results)
      cache.set('search:query', query.trim())
      cache.set('search:results', data.results)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query, cache])

  // Transform Release to AlbumTileItem
  const items: AlbumTileItem[] = results.map(r => ({
    artist:          r.artist,
    title:           r.title,
    year:            r.year,
    mbid:            r.mbid,
    in_library:      r.in_library,
    can_upgrade:     r.can_upgrade,
    library_quality: r.library_quality,
    type:            r.type,
  }))

  const requestAlbum = async (item: AlbumTileItem, upgrade = false) => {
    const key = `${item.artist}|${item.title}` + (upgrade ? '_u' : '')
    setRequesting(key)
    try {
      const result = await api.requests.album({
        artist:      item.artist,
        album:       item.title,
        year:        item.year ? parseInt(String(item.year)) : undefined,
        mbid:        item.mbid,
        format_pref: upgrade ? 'flac' : formatPref,
        force:       upgrade,
      })
      setFeedback(prev => ({ ...prev, [`${item.artist}|${item.title}`]: `Queued #${result.request_id}` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [`${item.artist}|${item.title}`]: '✗' }))
    } finally {
      setRequesting(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="page-subtitle">Find any album or artist on MusicBrainz</p>
        </div>
        {results.length > 0 && <ViewToggle mode={viewMode} onChange={setViewMode} />}
      </div>

      {/* Search bar */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-500" size={15} />
          <input
            className="input pl-9"
            placeholder="Artist, album, or track..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            autoFocus
          />
        </div>
        <select className="input w-28" value={formatPref}
          onChange={e => setFormatPref(e.target.value as 'mp3' | 'flac')}>
          <option value="mp3">MP3</option>
          <option value="flac">FLAC</option>
        </select>
        <button className="btn-primary px-6" onClick={doSearch}
          disabled={loading || query.trim().length < 2}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {results.length > 0 && (
        <>
          <p className="text-xs text-muted-500 mb-3 uppercase tracking-wider font-medium">
            {results.length} results for "{query}"
          </p>
          <PaginatedAlbumGrid
            items={items}
            viewMode={viewMode}
            onRequest={item => requestAlbum(item, false)}
            onUpgrade={item => requestAlbum(item, true)}
            requesting={requesting}
            feedback={feedback}
          />
        </>
      )}

      {results.length === 0 && !loading && (
        <div className="empty-state">
          <Search className="empty-state-icon" size={52} />
          <p className="empty-state-title">{query ? `No results for "${query}"` : 'Search MusicBrainz'}</p>
          <p className="empty-state-text">
            {query ? 'Try a different search term' : 'Find any album and request it for download via slskd'}
          </p>
        </div>
      )}
    </div>
  )
}
