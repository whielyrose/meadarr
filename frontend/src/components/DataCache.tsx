import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

// A simple key-value cache that survives navigation.
// Each entry has data + a timestamp so callers can decide when to refresh.
interface CacheEntry<T = any> {
  data: T
  fetchedAt: number
}

interface DataCacheContext {
  get:      <T>(key: string) => CacheEntry<T> | undefined
  set:      <T>(key: string, data: T) => void
  invalidate: (key: string) => void
  clear:    () => void
}

const Ctx = createContext<DataCacheContext | null>(null)

export function DataCacheProvider({ children }: { children: ReactNode }) {
  const [cache, setCache] = useState<Record<string, CacheEntry>>({})

  const get = useCallback(<T,>(key: string): CacheEntry<T> | undefined => {
    return cache[key] as CacheEntry<T> | undefined
  }, [cache])

  const set = useCallback(<T,>(key: string, data: T) => {
    setCache(prev => ({
      ...prev,
      [key]: { data, fetchedAt: Date.now() }
    }))
  }, [])

  const invalidate = useCallback((key: string) => {
    setCache(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const clear = useCallback(() => setCache({}), [])

  return (
    <Ctx.Provider value={{ get, set, invalidate, clear }}>
      {children}
    </Ctx.Provider>
  )
}

export function useDataCache() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useDataCache must be used inside DataCacheProvider')
  return ctx
}

// Convenience hook: get-or-fetch pattern with a cache key
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    enabled?:    boolean       // set false to skip auto-fetch
    forceRefresh?: number      // increment to trigger a refresh
  } = {}
): {
  data:    T | undefined
  loading: boolean
  error:   string | null
  refresh: () => void
  loaded:  boolean            // true once we've attempted at least one fetch
} {
  const { get, set } = useDataCache()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const entry = get<T>(key)
  const enabled = options.enabled !== false

  const refresh = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetcher()
      set(key, data)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [key, fetcher, set, enabled])

  // Auto-fetch on mount if cache miss
  // We use a ref-like pattern via useEffect
  const shouldFetch = enabled && !entry && !loading && !error
  if (shouldFetch) {
    // Fire once — Promise.resolve avoids setState during render
    Promise.resolve().then(refresh)
  }

  // Force refresh on trigger change
  const lastForce = get<number>(`__force:${key}`)
  if (options.forceRefresh !== undefined && enabled &&
      lastForce?.data !== options.forceRefresh) {
    set(`__force:${key}`, options.forceRefresh)
    Promise.resolve().then(refresh)
  }

  return {
    data:    entry?.data,
    loading,
    error,
    refresh,
    loaded:  !!entry,
  }
}
