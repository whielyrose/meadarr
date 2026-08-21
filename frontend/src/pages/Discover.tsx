import { useState, useEffect } from 'react'
import { Compass, Download, CheckCircle, RefreshCw, TrendingUp, Star } from 'lucide-react'
import { api, AlbumRec, ArtistRec } from '../api'

type Tab = 'missing' | 'top-albums' | 'recommendations' | 'new-releases'

const PERIODS = [
  { value: 'overall',  label: 'All Time' },
  { value: '12month',  label: '12 Months' },
  { value: '6month',   label: '6 Months' },
  { value: '1month',   label: '1 Month' },
  { value: '7day',     label: '7 Days' },
]

export default function DiscoverPage() {
  const [tab, setTab]               = useState<Tab>('missing')
  const [period, setPeriod]         = useState('overall')
  const [items, setItems]           = useState<any[]>([])
  const [loading, setLoading]       = useState(false)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback]     = useState<Record<string, string>>({})
  const [error, setError]           = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    setItems([])
    try {
      let data: any
      switch (tab) {
        case 'missing':
          data = await api.discover.missingFromLibrary(30)
          setItems(data.albums || [])
          break
        case 'top-albums':
          data = await api.discover.topAlbums(period, 30)
          setItems(data.albums || [])
          break
        case 'recommendations':
          data = await api.discover.recommendedArtists(20)
          setItems(data.artists || [])
          break
        case 'new-releases':
          data = await api.discover.newReleases(30)
          setItems(data.releases || [])
          break
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [tab, period])

  const requestAlbum = async (item: any) => {
    const key = `${item.artist}|${item.name || item.title}`
    setRequesting(key)
    try {
      const result = await api.requests.album({
        artist: item.artist || item.name,
        album: item.name || item.title,
        year: item.year ? parseInt(item.year) : undefined,
        mbid: item.mbid,
        format_pref: 'mp3',
      })
      setFeedback(prev => ({ ...prev, [key]: `✅ Queued (#${result.request_id})` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [key]: `❌ ${e.message}` }))
    } finally {
      setRequesting(null)
    }
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'missing',         label: 'Missing from Library', icon: Star },
    { id: 'top-albums',      label: 'Your Top Albums',      icon: TrendingUp },
    { id: 'recommendations', label: 'Recommended Artists',  icon: Compass },
    { id: 'new-releases',    label: 'New Releases',         icon: RefreshCw },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-6">Discover</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-900 rounded-lg p-1 border border-gray-800">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors ${
              tab === id
                ? 'bg-honey-500/20 text-honey-400 font-medium'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Period selector for top albums */}
      {tab === 'top-albums' && (
        <div className="flex gap-2 mb-4">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                period === p.value
                  ? 'bg-honey-500 text-gray-950 font-medium'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg p-3 mb-4 text-sm">
          {error}
          {error.includes('Last.fm') && (
            <span className="block mt-1 text-xs">Configure your Last.fm API key in Settings.</span>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-500">
          <RefreshCw className="animate-spin mx-auto mb-3" size={32} />
          <p>Loading recommendations...</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => {
            const key = `${item.artist || item.name}|${item.name || item.title}`
            const fb = feedback[key]
            const isRequesting = requesting === key
            const inLibrary = item.in_library
            const isArtistRec = tab === 'recommendations'

            return (
              <div key={i} className="card flex items-center gap-4">
                {/* Image or placeholder */}
                {item.image ? (
                  <img
                    src={item.image}
                    alt={item.name || item.title}
                    className="w-12 h-12 rounded-lg object-cover shrink-0 bg-gray-800"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div className="w-12 h-12 bg-gray-800 rounded-lg shrink-0 flex items-center justify-center">
                    <Compass className="text-gray-600" size={20} />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-100 truncate">
                      {item.name || item.title}
                    </span>
                    {item.year && (
                      <span className="text-xs text-gray-500">({item.year})</span>
                    )}
                    {inLibrary && (
                      <span className="badge badge-green">
                        In Library {item.library_quality ? `· ${item.library_quality.toUpperCase()}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 truncate">
                    {isArtistRec ? item.reason : item.artist}
                    {item.playcount && !isArtistRec && (
                      <span className="text-gray-600 ml-2">{Number(item.playcount).toLocaleString()} plays</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="shrink-0">
                  {fb ? (
                    <span className="text-xs text-gray-400">{fb}</span>
                  ) : isArtistRec ? (
                    <span className="text-xs text-gray-500">
                      {Math.round((item.match || 0) * 100)}% match
                    </span>
                  ) : inLibrary ? (
                    <CheckCircle className="text-green-500" size={18} />
                  ) : (
                    <button
                      className="btn-primary flex items-center gap-1"
                      onClick={() => requestAlbum(item)}
                      disabled={isRequesting}
                    >
                      <Download size={14} />
                      {isRequesting ? '...' : 'Request'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {items.length === 0 && !loading && (
            <div className="text-center py-16 text-gray-600">
              <Compass size={48} className="mx-auto mb-3 opacity-30" />
              <p>No recommendations yet</p>
              <p className="text-sm mt-1">Configure Last.fm in Settings to see personalised suggestions</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
