import { useState, useEffect, useCallback } from 'react'
import { Download, RefreshCw, XCircle, RotateCcw, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { api, DownloadRequest } from '../api'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  pending:     { label: 'Pending',     color: 'badge-gray',   icon: Clock },
  searching:   { label: 'Searching',   color: 'badge-blue',   icon: RefreshCw },
  downloading: { label: 'Downloading', color: 'badge-blue',   icon: Download },
  processing:  { label: 'Processing',  color: 'badge-yellow', icon: RefreshCw },
  completed:   { label: 'Completed',   color: 'badge-green',  icon: CheckCircle },
  failed:      { label: 'Failed',      color: 'badge-red',    icon: AlertCircle },
  duplicate:   { label: 'Duplicate',   color: 'badge-gray',   icon: CheckCircle },
  cancelled:   { label: 'Cancelled',   color: 'badge-gray',   icon: XCircle },
}

const FILTERS = ['all', 'pending', 'downloading', 'processing', 'completed', 'failed']

function formatTime(ts: number) {
  return new Date(ts * 1000).toLocaleString()
}

function formatBytes(bytes: number) {
  if (!bytes) return '—'
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

export default function QueuePage() {
  const [requests, setRequests]   = useState<DownloadRequest[]>([])
  const [total, setTotal]         = useState(0)
  const [filter, setFilter]       = useState('all')
  const [loading, setLoading]     = useState(false)
  const [expanded, setExpanded]   = useState<number | null>(null)

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.requests.list(filter === 'all' ? undefined : filter)
      setRequests(data.requests)
      setTotal(data.total)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchRequests()
    // Auto-refresh every 5s if there are active downloads
    const timer = setInterval(fetchRequests, 5000)
    return () => clearInterval(timer)
  }, [fetchRequests])

  const cancel = async (id: number) => {
    try {
      await api.requests.cancel(id)
      fetchRequests()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const retry = async (id: number) => {
    try {
      await api.requests.retry(id)
      fetchRequests()
    } catch (e: any) {
      alert(e.message)
    }
  }

  const toggleExpand = async (id: number) => {
    if (expanded === id) {
      setExpanded(null)
      return
    }
    setExpanded(id)
    // Fetch task details
    try {
      const data = await api.requests.get(id)
      setRequests(prev => prev.map(r => r.id === id ? { ...r, tasks: data.tasks } : r))
    } catch (e) {}
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Download Queue</h1>
        <button className="btn-ghost flex items-center gap-1" onClick={fetchRequests}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto pb-1">
        {FILTERS.map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
              filter === f
                ? 'bg-honey-500/20 text-honey-400 font-medium'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {requests.length === 0 && !loading ? (
        <div className="text-center py-16 text-gray-600">
          <Download size={48} className="mx-auto mb-3 opacity-30" />
          <p>No requests found</p>
          <p className="text-sm mt-1">Search for music and click Request to queue downloads</p>
        </div>
      ) : (
        <div className="space-y-2">
          {requests.map(req => {
            const status = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending
            const StatusIcon = status.icon
            const isActive = ['pending', 'searching', 'downloading', 'processing'].includes(req.status)

            return (
              <div key={req.id} className="card">
                <div
                  className="flex items-center gap-4 cursor-pointer"
                  onClick={() => toggleExpand(req.id)}
                >
                  {/* Status icon */}
                  <StatusIcon
                    size={18}
                    className={
                      req.status === 'completed' ? 'text-green-500' :
                      req.status === 'failed'    ? 'text-red-500' :
                      isActive                   ? 'text-honey-400 animate-pulse' :
                      'text-gray-600'
                    }
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-100 truncate">
                        {req.artist} — {req.album || req.title}
                      </span>
                      <span className={`badge ${status.color}`}>{status.label}</span>
                      <span className="badge badge-gray">{req.format_pref?.toUpperCase()}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Requested {formatTime(req.requested_at)}
                      {req.task_count && req.task_count > 0 && (
                        <span className="ml-2">
                          {req.completed_tasks}/{req.task_count} files
                        </span>
                      )}
                    </div>
                    {req.error_message && (
                      <div className="text-xs text-red-400 mt-1 truncate">{req.error_message}</div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {req.status === 'failed' && (
                      <button
                        className="btn-ghost flex items-center gap-1 text-xs"
                        onClick={() => retry(req.id)}
                      >
                        <RotateCcw size={12} /> Retry
                      </button>
                    )}
                    {isActive && (
                      <button
                        className="btn-ghost flex items-center gap-1 text-xs text-red-400"
                        onClick={() => cancel(req.id)}
                      >
                        <XCircle size={12} /> Cancel
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded task details */}
                {expanded === req.id && req.tasks && req.tasks.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-800 space-y-1">
                    {req.tasks.map(task => (
                      <div key={task.id} className="flex items-center gap-3 text-xs text-gray-400">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          task.status === 'completed'  ? 'bg-green-500' :
                          task.status === 'downloading'? 'bg-honey-400' :
                          task.status === 'failed'     ? 'bg-red-500' :
                          'bg-gray-600'
                        }`} />
                        <span className="truncate flex-1">{task.filename.split('\\').pop()?.split('/').pop()}</span>
                        <span className="shrink-0">{formatBytes(task.downloaded_size || 0)}</span>
                        <span className="shrink-0 text-gray-600">{task.peer}</span>
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
