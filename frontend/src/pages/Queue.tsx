import { useState, useEffect, useCallback } from 'react'
import { Download, RefreshCw, XCircle, RotateCcw,  Trash2, ChevronDown } from 'lucide-react'
import { api, DownloadRequest } from '../api'

const STATUS = {
  pending:     { label: 'Pending',     color: 'badge-gray',   dot: 'bg-muted-500' },
  searching:   { label: 'Searching',   color: 'badge-blue',   dot: 'bg-blue-400 animate-pulse' },
  downloading: { label: 'Downloading', color: 'badge-purple', dot: 'bg-accent-400 animate-pulse' },
  processing:  { label: 'Processing',  color: 'badge-yellow', dot: 'bg-yellow-400 animate-pulse' },
  completed:   { label: 'Completed',   color: 'badge-green',  dot: 'bg-green-500' },
  failed:      { label: 'Failed',      color: 'badge-red',    dot: 'bg-red-500' },
  duplicate:   { label: 'Duplicate',   color: 'badge-gray',   dot: 'bg-muted-500' },
  cancelled:   { label: 'Cancelled',   color: 'badge-gray',   dot: 'bg-muted-500' },
} as const

const FILTERS = ['all', 'pending', 'downloading', 'processing', 'completed', 'failed']

function ts(unix: number) { return new Date(unix * 1000).toLocaleString() }
function bytes(n: number) {
  if (!n) return '—'
  if (n > 1e9) return `${(n/1e9).toFixed(1)} GB`
  if (n > 1e6) return `${(n/1e6).toFixed(1)} MB`
  return `${(n/1e3).toFixed(0)} KB`
}

export default function QueuePage() {
  const [requests, setRequests] = useState<DownloadRequest[]>([])
  const [filter, setFilter]     = useState('all')
  const [loading, setLoading]   = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.requests.list(filter === 'all' ? undefined : filter)
      setRequests(d.requests)
    } catch {}
    finally { setLoading(false) }
  }, [filter])

  useEffect(() => {
    fetch_()
    const t = setInterval(fetch_, 5000)
    return () => clearInterval(t)
  }, [fetch_])

  const cancel = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try { await api.requests.cancel(id); fetch_() } catch (err: any) { alert(err.message) }
  }
  const del = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try { await api.requests.delete(id); setRequests(p => p.filter(r => r.id !== id)) }
    catch (err: any) { alert(err.message) }
  }
  const retry = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try { await api.requests.retry(id); fetch_() } catch (err: any) { alert(err.message) }
  }
  const clearFinished = async () => {
    const done = requests.filter(r => ['completed','failed','cancelled','duplicate'].includes(r.status))
    await Promise.all(done.map(r => api.requests.delete(r.id).catch(() => {})))
    fetch_()
  }
  const toggleExpand = async (id: number) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    try {
      const d = await api.requests.get(id)
      setRequests(p => p.map(r => r.id === id ? { ...r, tasks: d.tasks } : r))
    } catch {}
  }

  const isActive = (s: string) => ['pending','searching','downloading','processing'].includes(s)
  const hasFinished = requests.some(r => ['completed','failed','cancelled','duplicate'].includes(r.status))

  // Stats
  const active    = requests.filter(r => isActive(r.status)).length
  const completed = requests.filter(r => r.status === 'completed').length
  const failed    = requests.filter(r => r.status === 'failed').length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="page-header">
        <div>
          <h1 className="page-title">Download Queue</h1>
          <p className="page-subtitle">Track and manage your download requests</p>
        </div>
        <div className="flex gap-2">
          {hasFinished && (
            <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={clearFinished}>
              <Trash2 size={12} /> Clear Finished
            </button>
          )}
          <button className="btn-ghost flex items-center gap-1.5" onClick={fetch_}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {requests.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="stat-card">
            <p className="stat-value text-accent-200">{active}</p>
            <p className="stat-label">Active</p>
          </div>
          <div className="stat-card">
            <p className="stat-value text-green-400">{completed}</p>
            <p className="stat-label">Completed</p>
          </div>
          <div className="stat-card">
            <p className="stat-value text-red-400">{failed}</p>
            <p className="stat-label">Failed</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-1 mb-4 bg-surface-800 rounded-lg p-1 border border-surface-700 overflow-x-auto">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
              filter === f
                ? 'bg-accent-500/20 text-accent-200 border border-accent-500/30'
                : 'text-muted-400 hover:text-slate-300'
            }`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {requests.length === 0 && !loading ? (
        <div className="empty-state">
          <Download className="empty-state-icon" size={52} />
          <p className="empty-state-title">Queue is empty</p>
          <p className="empty-state-text">Search for music and click Request to start downloading</p>
        </div>
      ) : (
        <div className="space-y-2 animate-slide-in">
          {requests.map(req => {
            const status = STATUS[req.status as keyof typeof STATUS] || STATUS.pending
            const active_ = isActive(req.status)
            const canCancel = !['completed','cancelled'].includes(req.status)
            const isExp = expanded === req.id

            // Progress for downloading state
            const progress = req.task_count && req.completed_tasks !== undefined
              ? Math.round((req.completed_tasks / req.task_count) * 100)
              : null

            return (
              <div key={req.id} className="card cursor-pointer hover:border-surface-600 transition-all"
                onClick={() => toggleExpand(req.id)}>
                <div className="flex items-center gap-3">
                  {/* Status dot */}
                  <div className={`w-2 h-2 rounded-full shrink-0 ${status.dot}`} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-100 text-sm truncate">
                        {req.artist}
                        {(req.album || req.title) && (
                          <span className="text-muted-400 font-normal"> — {req.album || req.title}</span>
                        )}
                      </span>
                      <span className={status.color}>{status.label}</span>
                      <span className="badge badge-gray">{req.format_pref?.toUpperCase()}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-muted-500">{ts(req.requested_at)}</span>
                      {req.task_count && req.task_count > 0 && (
                        <span className="text-xs text-muted-500">
                          {req.completed_tasks}/{req.task_count} files
                        </span>
                      )}
                    </div>
                    {/* Progress bar for active downloads */}
                    {active_ && progress !== null && (
                      <div className="progress-bar mt-2">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                    {req.error_message && (
                      <p className="text-xs text-red-400 mt-1 truncate">{req.error_message}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    {req.status === 'failed' && (
                      <button className="btn-ghost flex items-center gap-1 text-xs py-1.5"
                        onClick={e => retry(req.id, e)}>
                        <RotateCcw size={11} /> Retry
                      </button>
                    )}
                    {canCancel && (
                      <button className="btn-ghost flex items-center gap-1 text-xs text-orange-400 py-1.5"
                        onClick={e => cancel(req.id, e)}>
                        <XCircle size={11} />
                      </button>
                    )}
                    <button className="btn-danger flex items-center gap-1 text-xs py-1.5"
                      onClick={e => del(req.id, e)}>
                      <Trash2 size={11} />
                    </button>
                    <ChevronDown size={14} className={`text-muted-500 transition-transform ${isExp ? 'rotate-180' : ''}`} />
                  </div>
                </div>

                {/* Expanded tasks */}
                {isExp && req.tasks && req.tasks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-surface-700 space-y-1.5">
                    {req.tasks.map(task => (
                      <div key={task.id} className="flex items-center gap-3 text-xs text-muted-400">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          task.status === 'completed'   ? 'bg-green-500' :
                          task.status === 'downloading' ? 'bg-accent-400' :
                          task.status === 'failed'      ? 'bg-red-500' : 'bg-muted-600'
                        }`} />
                        <span className="truncate flex-1 font-mono text-[11px]">
                          {task.filename.split('\\').pop()?.split('/').pop()}
                        </span>
                        <span className="shrink-0">{bytes(task.downloaded_size || 0)}</span>
                        <span className="shrink-0 text-muted-600">{task.peer}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
