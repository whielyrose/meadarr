import { useState, useEffect, useCallback } from 'react'
import {
  Compass, RefreshCw, TrendingUp, Star, Zap,
  Radio, Sparkles,
} from 'lucide-react'
import { api } from '../api'
import { PaginatedAlbumGrid, ViewToggle, AlbumTileItem } from '../components/AlbumGrid'

type Tab = 'missing' | 'top-albums' | 'recommendations' | 'new-releases'
type RecSource = 'auto' | 'listenbrainz' | 'lastfm'

const PERIODS = [
  { value: 'overall', label: 'All Time' },
  { value: '12month', label: '12 Months' },
  { value: '1month',  label: '1 Month'  },
  { value: '7day',    label: '7 Days'   },
]

const TABS: { id: Tab; label: string; icon: any; description: string }[] = [
  { id: 'missing',         label: 'Missing',      icon: Star,       description: 'Your top albums that aren\'t in your library yet' },
  { id: 'top-albums',      label: 'Top Albums',   icon: TrendingUp, description: 'Your most-listened albums' },
  { id: 'recommendations', label: 'Recommended',  icon: Compass,    description: 'Artists similar to what you already listen to' },
  { id: 'new-releases',    label: 'New Releases', icon: Zap,        description: 'Latest releases from your favourite artists' },
]

// Per-tab state — keeps items in memory across tab switches
interface TabState {
  items:  AlbumTileItem[]
  source: string
  loaded: boolean
  error:  string | null
}

const EMPTY_TAB: TabState = { items: [], source: '', loaded: false, error: null }

// LB / Lastfm availability info from API
interface Availability {
  listenbrainz_available: boolean
  lastfm_available: boolean
}

export default function DiscoverPage() {
  const [tab, setTab]         = useState<Tab>('missing')
  const [period, setPeriod]   = useState('overall')
  const [recSource, setRecSource] = useState<RecSource>('auto')
  const [viewMode, setViewMode]   = useState<'grid' | 'list'>('grid')

  // Persist data per tab via global DataCache (survives route changes)
  const cache = useDataCache()
  const [loading, setLoading] = useState(false)
  const [availability, setAvailability] = useState<Availability>({
    listenbrainz_available: false, lastfm_available: false,
  })

  // Requesting/feedback for download button
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback]     = useState<Record<string, string>>({})

  // Cache key per tab (with source for recommendations)
  const getKey = (t: Tab): string => {
    if (t === 'top-albums') return `${t}:${period}`
    if (t === 'recommendations') return `${t}:${recSource}`
    return t
  }

  const currentKey = getKey(tab)
  const cachedEntry = cache.get<TabState>(`discover:${currentKey}`)
  const currentState = cachedEntry?.data || EMPTY_TAB

  const fetchTab = useCallback(async (targetTab: Tab, force = false) => {
    const key = getKey(targetTab)
    const cacheKey = `discover:${key}`

    // Skip if already loaded and not forcing refresh
    if (!force && cache.get(cacheKey)?.data?.loaded) return

    setLoading(true)
    try {
      let data: any
      let transformed: AlbumTileItem[] = []
      let source = ''

      switch (targetTab) {
        case 'missing':
          data = await api.discover.missingFromLibrary(100)
          transformed = (data.albums || []).map((a: any): AlbumTileItem => ({
            artist:      a.artist,
            title:       a.name,
            in_library:  false,
            extra:       a.playcount || a.listen_count
              ? Number(a.playcount || a.listen_count).toLocaleString()
              : undefined,
            extra_label: (a.playcount || a.listen_count) ? 'plays' : undefined,
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
          source = data.source || ''
          break

        case 'recommendations':
          data = await api.discover.recommendedArtists(50, recSource)
          transformed = (data.artists || []).map((a: any): AlbumTileItem => ({
            artist:     a.name,
            title:      'Recommended Artist',
            in_library: a.in_library || false,
            extra:      a.match || a.similarity
              ? `${Math.round((a.match || a.similarity) * 100)}%`
              : undefined,
            extra_label: 'match',
          }))
          source = data.source || ''
          if (data.listenbrainz_available !== undefined) {
            setAvailability({
              listenbrainz_available: data.listenbrainz_available,
              lastfm_available: data.lastfm_available,
            })
          }
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

      cache.set(`discover:${key}`, { items: transformed, source, loaded: true, error: null })
    } catch (e: any) {
      cache.set(`discover:${key}`, { items: [], source: '', loaded: true, error: e.message })
    } finally {
      setLoading(false)
    }
  }, [cache, period, recSource])

  // Load current tab on mount and when tab/period/recSource changes
  useEffect(() => { fetchTab(tab) }, [tab, period, recSource, fetchTab])

  const refresh = () => fetchTab(tab, true)

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
    } finally { setRequesting(null) }
  }

  const currentTabInfo = TABS.find(t => t.id === tab)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="page-subtitle">
            {currentTabInfo?.description || 'Recommendations from ListenBrainz & Last.fm'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {currentState.items.length > 0 && (
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          )}
          <button
            className="btn-secondary flex items-center gap-2"
            onClick={refresh}
            disabled={loading}
            title="Refresh this tab"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
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
            {/* Show cached indicator */}
            {cache.get(`discover:${getKey(id)}`)?.data?.loaded && tab !== id && (
              <span className="hidden sm:inline w-1.5 h-1.5 rounded-full bg-green-400/60 ml-0.5" />
            )}
          </button>
        ))}
      </div>

      {/* Sub-controls per tab */}
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

      {tab === 'recommendations' && (
        <div className="flex gap-1.5 mb-4 items-center">
          <span className="text-xs text-muted-500 mr-1">Source:</span>
          <button onClick={() => setRecSource('auto')}
            className={`text-xs px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1 ${
              recSource === 'auto'
                ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20'
                : 'bg-surface-800 text-muted-400 hover:text-slate-300 border border-surface-700'
            }`}>
            <Sparkles size={11} /> Auto
          </button>
          <button onClick={() => setRecSource('listenbrainz')}
            disabled={availability.lastfm_available !== undefined && !availability.listenbrainz_available}
            className={`text-xs px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1 disabled:opacity-40 ${
              recSource === 'listenbrainz'
                ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20'
                : 'bg-surface-800 text-muted-400 hover:text-slate-300 border border-surface-700'
            }`}>
            <Radio size={11} /> ListenBrainz
          </button>
          <button onClick={() => setRecSource('lastfm')}
            disabled={availability.lastfm_available !== undefined && !availability.lastfm_available}
            className={`text-xs px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1 disabled:opacity-40 ${
              recSource === 'lastfm'
                ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20'
                : 'bg-surface-800 text-muted-400 hover:text-slate-300 border border-surface-700'
            }`}>
            <TrendingUp size={11} /> Last.fm
          </button>
          {currentState.source && currentState.source !== 'none' && recSource === 'auto' && (
            <span className="text-xs text-muted-600 ml-2">
              → using {currentState.source}
            </span>
          )}
        </div>
      )}

      {currentState.error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm">
          {currentState.error}
        </div>
      )}

      {loading && currentState.items.length === 0 ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">
            {tab === 'new-releases'
              ? 'Fetching new releases from MusicBrainz (this may take a moment)...'
              : 'Loading recommendations...'}
          </p>
        </div>
      ) : currentState.items.length > 0 ? (
        <PaginatedAlbumGrid
          items={currentState.items}
          viewMode={viewMode}
          onRequest={requestAlbum}
          requesting={requesting}
          feedback={feedback}
        />
      ) : (
        <div className="empty-state">
          <Compass className="empty-state-icon" size={52} />
          <p className="empty-state-title">
            No {tab.replace('-', ' ')} to show
          </p>
          <p className="empty-state-text">
            {tab === 'recommendations'
              ? recSource === 'listenbrainz'
                ? 'ListenBrainz needs you to follow troi-bot at listenbrainz.org/user/troi-bot/'
                : 'Try switching source or check your Last.fm history'
              : 'Configure ListenBrainz or Last.fm in Settings'}
          </p>
        </div>
      )}
    </div>
  )
}
