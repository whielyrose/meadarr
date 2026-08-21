// Meadarr API client
// All calls to the backend go through here

const BASE = '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

const get  = <T>(path: string)                  => req<T>('GET',    path)
const post = <T>(path: string, body?: unknown)  => req<T>('POST',   path, body)
const del  = <T>(path: string)                  => req<T>('DELETE', path)

export const api = {
  settings: {
    get:                ()      => get<Record<string, string>>('/settings'),
    update:             (data: Record<string, string>) => post('/settings', data),
    testSlskd:          ()      => post('/settings/test/slskd'),
    testJellyfin:       ()      => post('/settings/test/jellyfin'),
    testLastfm:         ()      => post('/settings/test/lastfm'),
    testListenbrainz:   ()      => post('/settings/test/listenbrainz'),
    testFluxer:         ()      => post('/settings/test/fluxer'),
  },

  search: {
    releases: (q: string, limit = 20) =>
      get<{ results: Release[] }>(`/search/releases?q=${encodeURIComponent(q)}&limit=${limit}`),
    artists: (q: string) =>
      get<{ results: Artist[] }>(`/search/artists?q=${encodeURIComponent(q)}`),
    artistReleases: (mbid: string) =>
      get<{ releases: Release[] }>(`/search/artists/${mbid}/releases`),
    releaseTracks: (mbid: string) =>
      get<{ tracks: Track[] }>(`/search/releases/${mbid}/tracks`),
    library: (q?: string, artist?: string, page = 1) => {
      const params = new URLSearchParams({ page: String(page) })
      if (q) params.set('q', q)
      if (artist) params.set('artist', artist)
      return get<LibraryPage>(`/search/library?${params}`)
    },
  },

  requests: {
    album: (data: AlbumRequest)   => post<RequestResult>('/requests/album', data),
    track: (data: TrackRequest)   => post<RequestResult>('/requests/track', data),
    list:  (status?: string)      => get<{ total: number; requests: DownloadRequest[] }>(
      `/requests${status ? `?status=${status}` : ''}`
    ),
    get:   (id: number)           => get<DownloadRequest>(`/requests/${id}`),
    cancel:(id: number)           => del(`/requests/${id}`),
    retry: (id: number)           => post(`/requests/${id}/retry`),
  },

  discover: {
    recommendedArtists: (limit = 20) =>
      get<{ artists: ArtistRec[]; source: string }>(`/discover/recommended-artists?limit=${limit}`),
    topArtists: (period = 'overall', limit = 20) =>
      get<{ artists: ArtistRec[]; source: string }>(`/discover/top-artists?period=${period}&limit=${limit}`),
    topAlbums: (period = 'overall', limit = 20) =>
      get<{ albums: AlbumRec[]; source: string }>(`/discover/top-albums?period=${period}&limit=${limit}`),
    similarArtists: (artist: string) =>
      get<{ similar: ArtistRec[] }>(`/discover/similar-artists/${encodeURIComponent(artist)}`),
    artistTopAlbums: (artist: string) =>
      get<{ albums: AlbumRec[] }>(`/discover/artist-top-albums/${encodeURIComponent(artist)}`),
    missingFromLibrary: (limit = 20) =>
      get<{ albums: AlbumRec[] }>(`/discover/missing-from-library?limit=${limit}`),
    newReleases: (limit = 20) =>
      get<{ releases: Release[] }>(`/discover/new-releases?limit=${limit}`),
  },

  playlists: {
    list:   ()                         => get<{ playlists: Playlist[] }>('/playlists'),
    create: (name: string, description?: string) =>
      post<{ id: number; jellyfin_id: string }>('/playlists', { name, description }),
    get:    (id: number)               => get<Playlist>(`/playlists/${id}`),
    addTracks: (id: number, data: AddTracksData) =>
      post(`/playlists/${id}/tracks`, data),
    delete: (id: number)               => del(`/playlists/${id}`),
    syncToJellyfin: (id: number)       => post(`/playlists/${id}/sync-to-jellyfin`),
  },

  library: {
    stats:   ()                        => get<LibraryStats>('/library/stats'),
    tracks:  (params?: TrackQueryParams) => {
      const p = new URLSearchParams()
      if (params?.q)      p.set('q', params.q)
      if (params?.artist) p.set('artist', params.artist)
      if (params?.album)  p.set('album', params.album)
      if (params?.page)   p.set('page', String(params.page))
      return get<LibraryPage>(`/library/tracks?${p}`)
    },
    artists: ()                        => get<{ artists: LibraryArtist[] }>('/library/artists'),
    artistAlbums: (artist: string)     =>
      get<{ artist: string; albums: LibraryAlbum[] }>(`/library/artists/${encodeURIComponent(artist)}/albums`),
    albumTracks: (artist: string, album: string) =>
      get<{ tracks: LibraryTrack[] }>(
        `/library/albums/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`
      ),
    scan:    ()                        => post('/library/scan'),
    scanHistory: ()                    => get<{ scans: ScanEntry[] }>('/library/scan/history'),
  },
}

export interface Release {
  mbid: string
  title: string
  artist: string
  artist_mbid?: string
  year?: string
  type?: string
  score?: number
  in_library?: boolean
  library_quality?: string
  can_upgrade?: boolean
}

export interface Artist {
  mbid: string
  name: string
  sort_name?: string
  type?: string
  country?: string
  disambiguation?: string
  score?: number
}

export interface Track {
  mbid?: string
  title: string
  track_number?: number
  disc_number?: number
  duration_ms?: number
}

export interface ArtistRec {
  name: string
  match?: number
  similarity?: number
  playcount?: number
  listen_count?: number
  rank?: number
  url?: string
  image?: string
  reason?: string
  in_library?: boolean
}

export interface AlbumRec {
  name: string
  artist: string
  playcount?: number
  listen_count?: number
  rank?: number
  url?: string
  image?: string
  in_library?: boolean
  library_quality?: string
}

export interface DownloadRequest {
  id: number
  type: string
  artist: string
  album?: string
  title?: string
  year?: number
  status: string
  format_pref: string
  error_message?: string
  retry_count: number
  requested_at: number
  completed_at?: number
  task_count?: number
  completed_tasks?: number
  tasks?: DownloadTask[]
}

export interface DownloadTask {
  id: number
  filename: string
  peer: string
  status: string
  expected_size?: number
  downloaded_size?: number
  dest_path?: string
}

export interface AlbumRequest {
  artist: string
  album: string
  year?: number
  mbid?: string
  format_pref?: string
  force?: boolean
}

export interface TrackRequest {
  artist: string
  title: string
  album?: string
  mbid?: string
  format_pref?: string
}

export interface RequestResult {
  status: string
  request_id: number
  message: string
}

export interface Playlist {
  id: number
  name: string
  description?: string
  jellyfin_id?: string
  track_count?: number
  auto_generated?: boolean
  created_at: number
  updated_at: number
  tracks?: PlaylistTrack[]
}

export interface PlaylistTrack {
  playlist_id: number
  jellyfin_item_id?: string
  artist?: string
  album?: string
  title?: string
  position: number
}

export interface AddTracksData {
  jellyfin_item_ids?: string[]
  tracks?: Array<{ artist: string; title: string; album?: string }>
}

export interface LibraryStats {
  total_tracks: number
  total_artists: number
  total_albums: number
  formats: Record<string, number>
  total_size_gb: number
}

export interface LibraryPage {
  total: number
  page: number
  per_page: number
  tracks: LibraryTrack[]
}

export interface LibraryTrack {
  id: number
  artist: string
  album: string
  title: string
  year?: number
  track_number?: number
  format?: string
  bitrate?: number
  duration_ms?: number
  file_path?: string
  file_size?: number
}

export interface LibraryArtist {
  artist: string
  album_count: number
  track_count: number
  formats: string
}

export interface LibraryAlbum {
  album: string
  year?: number
  track_count: number
  format?: string
}

export interface ScanEntry {
  id: number
  started_at: number
  completed_at?: number
  files_found: number
  files_added: number
  files_updated: number
  files_removed: number
  status: string
}

export interface TrackQueryParams {
  q?: string
  artist?: string
  album?: string
  page?: number
}
