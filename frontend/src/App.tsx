import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  Search, Compass, Download, Music, ListMusic,
  Settings, Import, Activity, ChevronRight
} from 'lucide-react'
import SearchPage    from './pages/Search'
import DiscoverPage  from './pages/Discover'
import QueuePage     from './pages/Queue'
import LibraryPage   from './pages/Library'
import PlaylistsPage from './pages/Playlists'
import SettingsPage  from './pages/Settings'
import ImportsPage   from './pages/Imports'

const NAV_SECTIONS = [
  {
    label: 'DISCOVER',
    items: [
      { to: '/',         icon: Search,    label: 'Search'   },
      { to: '/discover', icon: Compass,   label: 'Discover' },
      { to: '/import',   icon: Import,    label: 'Import'   },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { to: '/queue',     icon: Download,  label: 'Queue'     },
      { to: '/library',   icon: Music,     label: 'Library'   },
      { to: '/playlists', icon: ListMusic, label: 'Playlists' },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

// Animated waveform bars — the signature UI element
function Waveform() {
  return (
    <div className="flex items-center gap-0.5 h-4">
      {[
        'animate-wave',
        'animate-wave-delay-1',
        'animate-wave-delay-2',
        'animate-wave-delay-3',
        'animate-wave-delay-4',
      ].map((anim, i) => (
        <div
          key={i}
          className={`w-0.5 bg-accent-400 rounded-full origin-bottom ${anim}`}
          style={{ height: '100%' }}
        />
      ))}
    </div>
  )
}

export default function App() {
  const location = useLocation()

  // Check if any active downloads exist by checking queue route
  const isQueueActive = location.pathname === '/queue'

  return (
    <div className="flex h-screen overflow-hidden bg-surface-900">
      {/* ── Sidebar ── */}
      <aside className="w-56 flex flex-col shrink-0 border-r border-surface-700 bg-[#12151f]">

        {/* Logo */}
        <div className="px-4 py-5 border-b border-surface-700">
          <div className="flex items-center gap-2.5">
            <Waveform />
            <div>
              <span className="font-bold text-base text-slate-100 tracking-tight">
                Meadarr
              </span>
              <span className="text-accent-400 ml-1 text-sm">🍯</span>
            </div>
          </div>
          <p className="text-xs text-muted-500 mt-1">Music Manager</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-4">
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <p className="px-3 mb-1.5 text-xs font-semibold text-muted-600 tracking-widest uppercase">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/'}
                    className={({ isActive }) =>
                      isActive ? 'nav-item-active' : 'nav-item-inactive'
                    }
                  >
                    <Icon size={15} />
                    <span className="flex-1">{label}</span>
                    {to === '/queue' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-surface-700">
          <p className="text-xs text-muted-600">v1.0 · whielyironmead.com</p>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto bg-surface-900 animate-fade-in">
        <Routes>
          <Route path="/"          element={<SearchPage />}    />
          <Route path="/discover"  element={<DiscoverPage />}  />
          <Route path="/queue"     element={<QueuePage />}     />
          <Route path="/library"   element={<LibraryPage />}   />
          <Route path="/playlists" element={<PlaylistsPage />} />
          <Route path="/import"    element={<ImportsPage />}   />
          <Route path="/settings"  element={<SettingsPage />}  />
        </Routes>
      </main>
    </div>
  )
}
