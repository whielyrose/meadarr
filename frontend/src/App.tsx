import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  Search, Compass, Download, Music, ListMusic,
  Settings, Import, Menu, X,
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
    label: 'Discover',
    items: [
      { to: '/',         icon: Search,  label: 'Search'   },
      { to: '/discover', icon: Compass, label: 'Discover' },
      { to: '/import',   icon: Import,  label: 'Import'   },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/queue',     icon: Download,  label: 'Queue'     },
      { to: '/library',   icon: Music,     label: 'Library'   },
      { to: '/playlists', icon: ListMusic, label: 'Playlists' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

function Waveform() {
  return (
    <div className="flex items-end gap-0.5 h-4">
      {['animate-wave','animate-wave-delay-1','animate-wave-delay-2','animate-wave-delay-3','animate-wave-delay-4']
        .map((anim, i) => (
          <div key={i}
            className={`w-0.5 h-full bg-accent-400 rounded-full origin-bottom ${anim}`} />
        ))
      }
    </div>
  )
}

function Sidebar({ onNav }: { onNav?: () => void }) {
  return (
    <>
      <div className="px-5 py-5 border-b border-surface-700">
        <div className="flex items-center gap-2.5">
          <Waveform />
          <span className="font-bold text-base text-slate-100 tracking-tight">
            Meadarr
          </span>
          <span className="text-accent-400 text-sm">🍯</span>
        </div>
        <p className="text-[11px] text-muted-500 mt-1 ml-6">Music Manager</p>
      </div>

      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-4">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <p className="px-3 mb-1 text-[10px] font-bold text-muted-600 tracking-widest uppercase">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label }) => (
                <NavLink key={to} to={to} end={to === '/'} onClick={onNav}
                  className={({ isActive }) =>
                    isActive ? 'nav-item-active' : 'nav-item-inactive'
                  }>
                  <Icon size={15} />
                  <span className="flex-1">{label}</span>
                  {to === '/queue' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse-slow" />
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-surface-700">
        <p className="text-[10px] text-muted-600 uppercase tracking-wider">
          v1.0 · whielyironmead.com
        </p>
      </div>
    </>
  )
}

export default function App() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-40 bg-surface-800/90 backdrop-blur border border-surface-700
                   p-2 rounded-lg text-slate-200"
        aria-label="Open menu"
      >
        <Menu size={18} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile until opened */}
      <aside className={`
        w-52 flex flex-col shrink-0 border-r border-surface-700 bg-[#0d0f16]
        transition-transform duration-200
        lg:translate-x-0
        ${mobileOpen ? 'translate-x-0 fixed inset-y-0 left-0 z-50' : '-translate-x-full lg:relative lg:translate-x-0'}
      `}>
        {mobileOpen && (
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden absolute top-4 right-3 text-muted-400 p-1"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        )}
        <Sidebar onNav={() => setMobileOpen(false)} />
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface-950 animate-fade-in">
        {/* Mobile top-bar spacer */}
        <div className="lg:hidden h-12" />
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
