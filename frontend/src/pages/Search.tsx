import { useState, useCallback } from 'react'
import { Search, Download, CheckCircle, ArrowUpCircle, Disc3, Music2 } from 'lucide-react'
import { api, Release } from '../api'

export default function SearchPage() {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<Release[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [formatPref, setFormatPref] = useState<'mp3' | 'flac'>('mp3')

  const doSearch = useCallback(async () => {
    if (query.trim().length < 2) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.search.releases(query.trim())
      setResults(data.results)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query])

  const requestAlbum = async (release: Release, upgrade = false) => {
    const key = upgrade ? release.mbid + '_upgrade' : release.mbid
    setRequesting(key)
    try {
      const result = await api.requests.album({
        artist: release.artist,
        album: release.title,
        year: release.year ? parseInt(release.year) : undefined,
        mbid: release.mbid,
        format_pref: upgrade ? 'flac' : formatPref,
        force: upgrade,
      })
      setFeedback(prev => ({ ...prev, [release.mbid]: `Queued #${result.request_id}` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [release.mbid]: e.message }))
    } finally {
      setRequesting(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="page-subtitle">Find any album or artist on MusicBrainz</p>
        </div>
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
        <select
          className="input w-28"
          value={formatPref}
          onChange={e => setFormatPref(e.target.value as 'mp3' | 'flac')}
        >
          <option value="mp3">MP3</option>
          <option value="flac">FLAC</option>
        </select>
        <button
          className="btn-primary px-6"
          onClick={doSearch}
          disabled={loading || query.trim().length < 2}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <p className="text-xs text-muted-500 mb-3 uppercase tracking-wider">
            {results.length} results for "{query}"
          </p>
          <div className="space-y-2 animate-slide-in">
            {results.map(release => {
              const fb = feedback[release.mbid]
              const isReq = requesting === release.mbid || requesting === release.mbid + '_upgrade'

              return (
                <div key={release.mbid} className="table-row rounded-lg bg-surface-800 border border-surface-700">
                  {/* Album art placeholder */}
                  <div className="w-10 h-10 bg-surface-700 rounded-lg flex items-center justify-center shrink-0">
                    <Disc3 className="text-muted-600" size={18} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-100 truncate text-sm">{release.title}</span>
                      {release.year && <span className="text-xs text-muted-500">{release.year}</span>}
                      {release.type && release.type !== 'Album' && (
                        <span className="badge badge-gray">{release.type}</span>
                      )}
                      {release.in_library && (
                        <span className="badge badge-purple">
                          In Library{release.library_quality ? ` · ${release.library_quality.toUpperCase()}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-400 mt-0.5 truncate">{release.artist}</p>
                  </div>

                  {/* Action */}
                  <div className="shrink-0 flex items-center gap-2">
                    {fb ? (
                      <span className="text-xs text-accent-300 flex items-center gap-1">
                        <CheckCircle size={12} /> {fb}
                      </span>
                    ) : release.in_library ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle className="text-green-500" size={16} />
                        {release.can_upgrade && (
                          <button
                            className="btn-secondary flex items-center gap-1 py-1.5"
                            onClick={() => requestAlbum(release, true)}
                            disabled={isReq}
                          >
                            <ArrowUpCircle size={13} /> FLAC
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        className="btn-primary flex items-center gap-1 py-1.5"
                        onClick={() => requestAlbum(release)}
                        disabled={isReq}
                      >
                        <Download size={13} />
                        {isReq ? 'Queuing...' : 'Request'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {results.length === 0 && !loading && (
        <div className="empty-state">
          <Music2 className="empty-state-icon" size={52} />
          <p className="empty-state-title">{query ? `No results for "${query}"` : 'Search MusicBrainz'}</p>
          <p className="empty-state-text">
            {query ? 'Try a different search term' : 'Find any album or artist and request it for download'}
          </p>
        </div>
      )}
    </div>
  )
}
