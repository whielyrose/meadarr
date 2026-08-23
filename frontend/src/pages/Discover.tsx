import { useState, useEffect } from 'react'
import { Compass, RefreshCw, TrendingUp, Star, Zap } from 'lucide-react'
import { api } from '../api'
import { PaginatedAlbumGrid, ViewToggle, AlbumTileItem } from '../components/AlbumGrid'

type Tab = 'missing' | 'top-albums' | 'recommendations' | 'new-releases'

const PERIODS = [
  { value: 'overall', label: 'All Time' },
  { value: '12month', label: '12 Months' },
  { value: '1month',  label: '1 Month'  },
  { value: '7day',    label: '7 Days'   },
]

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'missing',         label: 'Missing',       icon: Star },
  { id: 'top-albums',      label: 'Top Albums',    icon: TrendingUp },
  { id: 'recommendations', label: 'Recommended',   icon: Compass },
  { id: 'new-releases',    label: 'New Releases',  icon: Zap },
]

export default function DiscoverPage() {
  const [tab, setTab]           = useState<Tab>('missing')
  const [period, setPeriod]     = useState('overall')
  const [items, setItems]       = useState<AlbumTileItem[]>([])
  const [source, setSource]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback]     = useState<Record<string, string>>({})
  const [error, setError]           = useState<string | null>(null)
  const [viewMode, setViewMode]     = useState<'grid' | 'list'>('grid')

  const fetchData = async () => {
    setLoading(true); setError(null); setItems([])
    try {
      let data: any
      let transformed: AlbumTileItem[] = []

      switch (tab) {
        case 'missing':
          data = await api.discover.missingFromLibrary(100)
          transformed = (data.albums || []).map((a: any): AlbumTileItem => ({
            artist:     a.artist,
            title:      a.name,
            in_library: false,
            extra:      a.playcount || a.listen_count
              ? Number(a.playcount || a.listen_count).toLocaleString()
              : undefined,
            extra_label: a.playcount || a.listen_count ? 'plays' : undefined,
          }))
          break
        case 'top-albums':
          data = await api.discover.topAlbums(period, 100)
          transformed = (data.albums || []).map((a: any): AlbumTileItem => ({
            artist:          a.artist,
            title:           a.name,
            in_library:      a.in_library,
            library_quality: a.library_quality,
            extra:           a.playcount || a.listen_count
              ? Number(a.playcount || a.listen_count).toLocaleString()
              : undefined,
            extra_label:     'plays',
          }))
          setSource(data.source || '')
          break
        case 'recommendations':
          data = await api.discover.recommendedArtists(50)
          transformed = (data.artists || []).map((a: any): AlbumTileItem => ({
            artist:     a.name,
            title:      'Recommended Artist',
            in_library: a.in_library || false,
            extra:      a.match || a.similarity
              ? `${Math.round((a.match || a.similarity) * 100)}%`
              : undefined,
            extra_label: 'match',
          }))
          setSource(data.source || '')
          break
        case 'new-releases':
          data = await api.discover.newReleases(100)
          transformed = (data.releases || []).map((r: any): AlbumTileItem => ({
            artist:          r.artist,
            title:           r.title,
            year:            r.year,
            mbid:            r.mbid,
            type:            r.type,
            in_library:      r.in_library,
            library_quality: r.library_quality,
          }))
          break
      }

      setItems(transformed)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [tab, period])

  const requestAlbum = async (item: AlbumTileItem) => {
    const key = `${item.artist}|${item.title}`
    setRequesting(key)
    try {
      const result = await api.requests.album({
        artist:      item.artist,
        album:       item.title,
        year:        item.year ? parseInt(String(item.year)) : undefined,
        mbid:        item.mbid,
        format_pref: 'mp3',
      })
      setFeedback(prev => ({ ...prev, [key]: `Queued #${result.request_id}` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [key]: '✗' }))
    } finally {
      setRequesting(null)
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="page-subtitle">
            Recommendations from {source || 'ListenBrainz & Last.fm'}
          </p>
        </div>
        {items.length > 0 && <ViewToggle mode={viewMode} onChange={setViewMode} />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-surface-800 rounded-lg p-1 border border-surface-700">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
              tab === id
                ? 'bg-accent-500/20 text-accent-200 border border-accent-500/30'
                : 'text-muted-400 hover:text-slate-300'
            }`}>
            <Icon size={13} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Period selector for top albums */}
      {tab === 'top-albums' && (
        <div className="flex gap-1.5 mb-4">
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-all font-medium ${
                period === p.value
                  ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20'
                  : 'bg-surface-800 text-muted-400 hover:text-slate-300 border border-surface-700'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">Loading recommendations...</p>
        </div>
      ) : items.length > 0 ? (
        <PaginatedAlbumGrid
          items={items}
          viewMode={viewMode}
          onRequest={requestAlbum}
          requesting={requesting}
          feedback={feedback}
        />
      ) : (
        <div className="empty-state">
          <Compass className="empty-state-icon" size={52} />
          <p className="empty-state-title">No {tab.replace('-', ' ')} available</p>
          <p className="empty-state-text">
            {source === 'none'
              ? 'Configure ListenBrainz or Last.fm in Settings'
              : 'Try a different tab or check your listening history'}
          </p>
        </div>
      )}
    </div>
  )
}
