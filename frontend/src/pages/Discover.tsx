import { useState, useEffect } from 'react'
import { Compass, Download, CheckCircle, RefreshCw, TrendingUp, Star, Zap } from 'lucide-react'
import { api, AlbumRec, ArtistRec } from '../api'

type Tab = 'missing' | 'top-albums' | 'recommendations' | 'new-releases'
const PERIODS = [
  { value: 'overall', label: 'All Time' },
  { value: '12month', label: '12 Months' },
  { value: '1month',  label: '1 Month'  },
  { value: '7day',    label: '7 Days'   },
]

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'missing',         label: 'Missing',         icon: Star     },
  { id: 'top-albums',      label: 'Top Albums',       icon: TrendingUp },
  { id: 'recommendations', label: 'Recommended',      icon: Compass  },
  { id: 'new-releases',    label: 'New Releases',     icon: Zap      },
]

export default function DiscoverPage() {
  const [tab, setTab]               = useState<Tab>('missing')
  const [period, setPeriod]         = useState('overall')
  const [items, setItems]           = useState<any[]>([])
  const [source, setSource]         = useState('')
  const [loading, setLoading]       = useState(false)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback]     = useState<Record<string, string>>({})
  const [error, setError]           = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true); setError(null); setItems([])
    try {
      let data: any
      switch (tab) {
        case 'missing':
          data = await api.discover.missingFromLibrary(30); setItems(data.albums || []); break
        case 'top-albums':
          data = await api.discover.topAlbums(period, 30); setItems(data.albums || [])
          setSource(data.source || ''); break
        case 'recommendations':
          data = await api.discover.recommendedArtists(20); setItems(data.artists || [])
          setSource(data.source || ''); break
        case 'new-releases':
          data = await api.discover.newReleases(30); setItems(data.releases || []); break
      }
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchData() }, [tab, period])

  const requestAlbum = async (item: any) => {
    const key = `${item.artist || item.name}|${item.name || item.title}`
    setRequesting(key)
    try {
      const result = await api.requests.album({
        artist: item.artist || item.name,
        album: item.name || item.title,
        year: item.year ? parseInt(item.year) : undefined,
        mbid: item.mbid,
        format_pref: 'mp3',
      })
      setFeedback(prev => ({ ...prev, [key]: `#${result.request_id}` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [key]: '✗' }))
    } finally { setRequesting(null) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Discover</h1>
          <p className="page-subtitle">
            Personalised recommendations from {source || 'ListenBrainz & Last.fm'}
          </p>
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
          </button>
        ))}
      </div>

      {/* Period selector */}
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
          {error.includes('Last.fm') || error.includes('ListenBrainz')
            ? <span className="block mt-1 text-xs">Configure your music service in Settings.</span>
            : null}
        </div>
      )}

      {loading ? (
        <div className="empty-state">
          <RefreshCw className="animate-spin text-accent-400 mb-3" size={32} />
          <p className="text-muted-500 text-sm">Loading recommendations...</p>
        </div>
      ) : (
        <div className="space-y-2 animate-slide-in">
          {items.map((item, i) => {
            const key = `${item.artist || item.name}|${item.name || item.title}`
            const fb = feedback[key]
            const isReq = requesting === key
            const inLib = item.in_library
            const isArtist = tab === 'recommendations'

            return (
              <div key={i} className="table-row rounded-lg bg-surface-800 border border-surface-700">
                {item.image ? (
                  <img src={item.image} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0 bg-surface-700"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <div className="w-10 h-10 bg-surface-700 rounded-lg shrink-0 flex items-center justify-center border border-surface-600">
                    <Compass className="text-muted-600" size={16} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-100 text-sm truncate">
                      {item.name || item.title}
                    </span>
                    {item.year && <span className="text-xs text-muted-500">({item.year})</span>}
                    {inLib && (
                      <span className="badge badge-purple">
                        In Library{item.library_quality ? ` · ${item.library_quality.toUpperCase()}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-400 mt-0.5 truncate">
                    {isArtist ? item.reason : item.artist}
                    {(item.listen_count || item.playcount) && !isArtist && (
                      <span className="text-muted-600 ml-2">
                        {(item.listen_count || item.playcount).toLocaleString()} plays
                      </span>
                    )}
                  </p>
                </div>

                <div className="shrink-0">
                  {fb ? (
                    <span className="text-xs text-accent-300 flex items-center gap-1">
                      <CheckCircle size={12} /> Queued {fb}
                    </span>
                  ) : isArtist ? (
                    <span className="text-xs text-muted-500">
                      {Math.round(((item.match || item.similarity || 0) as number) * 100)}% match
                    </span>
                  ) : inLib ? (
                    <CheckCircle className="text-green-500" size={16} />
                  ) : (
                    <button className="btn-primary flex items-center gap-1 py-1.5 text-xs"
                      onClick={() => requestAlbum(item)} disabled={isReq}>
                      <Download size={12} />
                      {isReq ? '...' : 'Request'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {items.length === 0 && !loading && (
            <div className="empty-state">
              <Compass className="empty-state-icon" size={52} />
              <p className="empty-state-title">No recommendations yet</p>
              <p className="empty-state-text">Configure ListenBrainz or Last.fm in Settings</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
