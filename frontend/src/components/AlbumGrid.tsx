import { useState, useEffect, useMemo } from 'react'
import {
  Disc3, ChevronLeft, ChevronRight, Download, CheckCircle,
  ArrowUpCircle, Music2, LayoutGrid, List, Play,
} from 'lucide-react'
import PreviewModal from './PreviewModal'
import { useDataCache } from './DataCache'

export const GRID_PAGE_SIZE = 25 // 5 x 5

// Shared album art hook — fetches from backend /api/library/art
// Uses DataCache so art doesn't reload every time you switch pages.
export function useAlbumArt(artist?: string, album?: string, mbid?: string) {
  const cache = useDataCache()
  const key = artist && album ? `art:${artist.toLowerCase()}|${album.toLowerCase()}` : null
  const cached = key ? cache.get<string | null>(key) : undefined
  const [url, setUrl] = useState<string | null>(cached?.data ?? null)

  useEffect(() => {
    if (!artist || !album || !key) return
    // If we already have it cached, use that (even if null — cache the "no art" result too)
    if (cached !== undefined) {
      setUrl(cached.data)
      return
    }
    let cancelled = false
    const params = new URLSearchParams({ artist, album })
    if (mbid) params.set('mbid', mbid)
    fetch(`/api/library/art?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return
        const resolvedUrl = d?.url || null
        setUrl(resolvedUrl)
        cache.set(key, resolvedUrl)
      })
      .catch(() => {
        if (!cancelled) cache.set(key, null)
      })
    return () => { cancelled = true }
  }, [artist, album, mbid, key])

  return url
}

// Reusable album tile (art + text + action button)
export interface AlbumTileItem {
  artist:       string
  title:        string
  year?:        string | number
  mbid?:        string
  in_library?:  boolean
  can_upgrade?: boolean
  library_quality?: string
  type?:        string
  extra?:       string  // e.g. play count, similarity %
  extra_label?: string
}

export function AlbumTile({
  item, onRequest, onUpgrade, requesting, feedback,
}: {
  item:      AlbumTileItem
  onRequest?: (item: AlbumTileItem) => void
  onUpgrade?: (item: AlbumTileItem) => void
  requesting?: boolean
  feedback?:  string
}) {
  const artUrl = useAlbumArt(item.artist, item.title, item.mbid)
  const [failed, setFailed] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  return (
    <div className="group flex flex-col">
      <div className="relative aspect-square rounded-lg overflow-hidden mb-2 shadow-lg shadow-black/40 bg-surface-700 border border-surface-600">
        {artUrl && !failed ? (
          <img src={artUrl} alt={item.title}
            className="w-full h-full object-cover"
            onError={() => setFailed(true)} loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Disc3 className="text-muted-600" size={32} />
          </div>
        )}

        {/* Status overlay in corner */}
        {item.in_library && (
          <div className="absolute top-2 right-2 bg-green-500/90 rounded-full p-1">
            <CheckCircle className="text-white" size={12} />
          </div>
        )}

        {/* Preview play button — top left corner */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); e.preventDefault(); setShowPreview(true) }}
          className="absolute top-2 left-2 z-20 w-8 h-8 rounded-full bg-accent-500 hover:bg-accent-400 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg cursor-pointer"
          title="Preview album"
        >
          <Play size={12} fill="currentColor" className="ml-0.5 pointer-events-none" />
        </button>

        {/* Hover overlay with actions */}
        <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col justify-end p-2.5 pointer-events-none [&_button]:pointer-events-auto">
          <p className="text-xs font-semibold text-white leading-tight line-clamp-2 mb-1">
            {item.title}
          </p>
          <p className="text-xs text-white/70 mb-2 truncate">{item.artist}</p>

          {/* Action button */}
          {feedback ? (
            <div className="text-xs text-accent-200 flex items-center gap-1 bg-accent-500/30 rounded-md px-2 py-1">
              <CheckCircle size={11} /> {feedback}
            </div>
          ) : item.in_library ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-green-400 flex-1">
                {item.library_quality
                  ? `Have · ${item.library_quality.toUpperCase()}`
                  : 'In Library'}
              </span>
              {item.can_upgrade && onUpgrade && (
                <button
                  onClick={e => { e.stopPropagation(); onUpgrade(item) }}
                  disabled={requesting}
                  className="bg-accent-500 hover:bg-accent-600 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1 shrink-0">
                  <ArrowUpCircle size={11} /> FLAC
                </button>
              )}
            </div>
          ) : onRequest ? (
            <button
              onClick={e => { e.stopPropagation(); onRequest(item) }}
              disabled={requesting}
              className="bg-accent-500 hover:bg-accent-600 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1 justify-center">
              <Download size={11} />
              {requesting ? '...' : 'Request'}
            </button>
          ) : null}
        </div>
      </div>

      <p className="text-xs font-medium text-slate-300 truncate leading-tight">{item.title}</p>
      <p className="text-xs text-muted-500 truncate">{item.artist}</p>
      <p className="text-xs text-muted-600 mt-0.5 truncate">
        {item.year && <span>{item.year}</span>}
        {item.extra && (
          <span className="text-muted-500 ml-1">
            {item.extra_label ? `${item.extra_label}: ` : ''}{item.extra}
          </span>
        )}
      </p>

      {showPreview && (
        <PreviewModal
          artist={item.artist}
          album={item.title}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}

// Pagination controls
export function Pagination({
  page, totalPages, totalItems, onPageChange,
}: {
  page:         number
  totalPages:   number
  totalItems:   number
  onPageChange: (p: number) => void
}) {
  if (totalPages <= 1) return null
  const from = page * GRID_PAGE_SIZE + 1
  const to   = Math.min((page + 1) * GRID_PAGE_SIZE, totalItems)

  return (
    <div className="flex items-center justify-between border-t border-surface-700 pt-4 mt-6">
      <p className="text-xs text-muted-500">
        Showing {from}–{to} of {totalItems}
      </p>
      <div className="flex gap-2 items-center">
        <button onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page === 0}
          className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs text-slate-300 font-medium px-3">
          Page {page + 1} of {totalPages}
        </span>
        <button onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page === totalPages - 1}
          className="btn-ghost p-2 disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

// View mode toggle
export function ViewToggle({
  mode, onChange,
}: {
  mode: 'grid' | 'list'
  onChange: (m: 'grid' | 'list') => void
}) {
  return (
    <div className="flex bg-surface-800 rounded-lg border border-surface-700 p-0.5">
      <button onClick={() => onChange('grid')} title="Grid view"
        className={`p-1.5 rounded-md transition-all ${
          mode === 'grid' ? 'bg-accent-500/20 text-accent-200' : 'text-muted-400 hover:text-slate-300'
        }`}>
        <LayoutGrid size={14} />
      </button>
      <button onClick={() => onChange('list')} title="List view"
        className={`p-1.5 rounded-md transition-all ${
          mode === 'list' ? 'bg-accent-500/20 text-accent-200' : 'text-muted-400 hover:text-slate-300'
        }`}>
        <List size={14} />
      </button>
    </div>
  )
}

// Full grid with pagination
export function PaginatedAlbumGrid<T extends AlbumTileItem>({
  items, viewMode, onRequest, onUpgrade, requesting, feedback,
}: {
  items:      T[]
  viewMode:   'grid' | 'list'
  onRequest?: (item: T) => void
  onUpgrade?: (item: T) => void
  requesting?: string | null
  feedback?:  Record<string, string>
}) {
  const [page, setPage] = useState(0)

  // Reset page when items change (e.g. new search)
  useEffect(() => { setPage(0) }, [items.length, items[0]?.title])

  const totalPages = Math.max(1, Math.ceil(items.length / GRID_PAGE_SIZE))
  const currentPage = items.slice(page * GRID_PAGE_SIZE, (page + 1) * GRID_PAGE_SIZE)

  const getKey = (item: T) => `${item.artist}|${item.title}`

  if (items.length === 0) return null

  return (
    <>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 animate-slide-in">
          {currentPage.map(item => {
            const key = getKey(item)
            return (
              <AlbumTile
                key={key}
                item={item}
                onRequest={onRequest as any}
                onUpgrade={onUpgrade as any}
                requesting={requesting === key || requesting === key + '_u'}
                feedback={feedback?.[key]}
              />
            )
          })}
        </div>
      ) : (
        <div className="space-y-2 animate-slide-in">
          {currentPage.map(item => {
            const key = getKey(item)
            return (
              <AlbumRow
                key={key}
                item={item}
                onRequest={onRequest as any}
                onUpgrade={onUpgrade as any}
                requesting={requesting === key || requesting === key + '_u'}
                feedback={feedback?.[key]}
              />
            )
          })}
        </div>
      )}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={items.length}
        onPageChange={setPage}
      />
    </>
  )
}

// List-view row (compact horizontal layout)
export function AlbumRow({
  item, onRequest, onUpgrade, requesting, feedback,
}: {
  item:      AlbumTileItem
  onRequest?: (item: AlbumTileItem) => void
  onUpgrade?: (item: AlbumTileItem) => void
  requesting?: boolean
  feedback?:  string
}) {
  const artUrl = useAlbumArt(item.artist, item.title, item.mbid)
  const [failed, setFailed] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  return (
    <div className="flex items-center gap-3 bg-surface-800 rounded-lg border border-surface-700 px-3 py-2.5 hover:border-accent-500/20 transition-all">
      <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-surface-700 border border-surface-600">
        {artUrl && !failed ? (
          <img src={artUrl} alt={item.title}
            className="w-full h-full object-cover"
            onError={() => setFailed(true)} loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music2 className="text-muted-600" size={14} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm text-slate-100 font-medium truncate">{item.title}</p>
          {item.year && <span className="text-xs text-muted-500">{item.year}</span>}
          {item.type && item.type !== 'Album' && (
            <span className="badge badge-gray">{item.type}</span>
          )}
          {item.in_library && (
            <span className="badge badge-purple">
              In Library{item.library_quality ? ` · ${item.library_quality.toUpperCase()}` : ''}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-400 truncate">
          {item.artist}
          {item.extra && (
            <span className="text-muted-600 ml-2">
              {item.extra_label ? `${item.extra_label}: ` : ''}{item.extra}
            </span>
          )}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <button
          onClick={() => setShowPreview(true)}
          className="btn-ghost p-2"
          title="Preview album"
        >
          <Play size={13} />
        </button>
        {feedback ? (
          <span className="text-xs text-accent-300 flex items-center gap-1">
            <CheckCircle size={12} /> {feedback}
          </span>
        ) : item.in_library ? (
          <div className="flex items-center gap-2">
            <CheckCircle className="text-green-500" size={16} />
            {item.can_upgrade && onUpgrade && (
              <button onClick={() => onUpgrade(item)} disabled={requesting}
                className="btn-secondary flex items-center gap-1 py-1.5 text-xs">
                <ArrowUpCircle size={13} /> FLAC
              </button>
            )}
          </div>
        ) : onRequest ? (
          <button onClick={() => onRequest(item)} disabled={requesting}
            className="btn-primary flex items-center gap-1 py-1.5 text-xs">
            <Download size={13} />{requesting ? '...' : 'Request'}
          </button>
        ) : null}
      </div>

      {showPreview && (
        <PreviewModal
          artist={item.artist}
          album={item.title}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
