import { useState, useCallback } from 'react'
import { Search, Download, CheckCircle, ArrowUpCircle, Music2, Disc3 } from 'lucide-react'
import { api, Release } from '../api'

type FormatPref = 'mp3' | 'flac'

export default function SearchPage() {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<Release[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [requesting, setRequesting] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [formatPref, setFormatPref] = useState<FormatPref>('mp3')

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') doSearch()
  }

  const requestAlbum = async (release: Release) => {
    setRequesting(release.mbid)
    try {
      const result = await api.requests.album({
        artist: release.artist,
        album: release.title,
        year: release.year ? parseInt(release.year) : undefined,
        mbid: release.mbid,
        format_pref: formatPref,
      })
      setFeedback(prev => ({ ...prev, [release.mbid]: `✅ Queued (#${result.request_id})` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [release.mbid]: `❌ ${e.message}` }))
    } finally {
      setRequesting(null)
    }
  }

  const requestUpgrade = async (release: Release) => {
    setRequesting(release.mbid + '_upgrade')
    try {
      const result = await api.requests.album({
        artist: release.artist,
        album: release.title,
        year: release.year ? parseInt(release.year) : undefined,
        mbid: release.mbid,
        format_pref: 'flac',
        force: true,
      })
      setFeedback(prev => ({ ...prev, [release.mbid]: `✅ Upgrade queued (#${result.request_id})` }))
    } catch (e: any) {
      setFeedback(prev => ({ ...prev, [release.mbid]: `❌ ${e.message}` }))
    } finally {
      setRequesting(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-6">Search Music</h1>

      {/* Search bar */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
          <input
            className="input pl-9"
            placeholder="Search for an artist, album, or track..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>

        <select
          className="input w-28"
          value={formatPref}
          onChange={e => setFormatPref(e.target.value as FormatPref)}
          title="Preferred format"
        >
          <option value="mp3">MP3</option>
          <option value="flac">FLAC</option>
        </select>

        <button
          className="btn-primary"
          onClick={doSearch}
          disabled={loading || query.trim().length < 2}
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 text-red-300 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-3">{results.length} results for "{query}"</p>

          {results.map(release => {
            const fb = feedback[release.mbid]
            const isRequesting = requesting === release.mbid || requesting === release.mbid + '_upgrade'

            return (
              <div key={release.mbid} className="card flex items-center gap-4">
                {/* Icon */}
                <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center shrink-0">
                  <Disc3 className="text-gray-600" size={20} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-100 truncate">{release.title}</span>
                    {release.year && (
                      <span className="text-xs text-gray-500">({release.year})</span>
                    )}
                    {release.type && release.type !== 'Album' && (
                      <span className="badge badge-gray">{release.type}</span>
                    )}
                    {release.in_library && (
                      <span className="badge badge-green">
                        In Library {release.library_quality ? `· ${release.library_quality.toUpperCase()}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400 truncate">{release.artist}</div>
                </div>

                {/* Actions */}
                <div className="shrink-0 flex items-center gap-2">
                  {fb ? (
                    <span className="text-xs text-gray-400">{fb}</span>
                  ) : release.in_library ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="text-green-500" size={16} />
                      {release.can_upgrade && release.library_quality === 'mp3' && (
                        <button
                          className="btn-secondary flex items-center gap-1"
                          onClick={() => requestUpgrade(release)}
                          disabled={isRequesting}
                          title="Download FLAC upgrade"
                        >
                          <ArrowUpCircle size={14} />
                          FLAC
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      className="btn-primary flex items-center gap-1"
                      onClick={() => requestAlbum(release)}
                      disabled={isRequesting}
                    >
                      <Download size={14} />
                      {isRequesting ? 'Queuing...' : 'Request'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {results.length === 0 && !loading && query && (
        <div className="text-center py-16 text-gray-600">
          <Music2 size={48} className="mx-auto mb-3 opacity-30" />
          <p>No results found for "{query}"</p>
          <p className="text-sm mt-1">Try a different search term</p>
        </div>
      )}

      {results.length === 0 && !loading && !query && (
        <div className="text-center py-16 text-gray-700">
          <Search size={48} className="mx-auto mb-3 opacity-20" />
          <p className="text-lg">Search MusicBrainz</p>
          <p className="text-sm mt-1 text-gray-600">Find any album or artist and request it for download</p>
        </div>
      )}
    </div>
  )
}
