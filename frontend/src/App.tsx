import { Routes, Route, NavLink } from 'react-router-dom'
import { Search, Compass, Download, Music, ListMusic, Settings, Disc3, Import } from 'lucide-react'
import SearchPage    from './pages/Search'
import DiscoverPage  from './pages/Discover'
import QueuePage     from './pages/Queue'
import LibraryPage   from './pages/Library'
import PlaylistsPage from './pages/Playlists'
import SettingsPage  from './pages/Settings'
import ImportsPage   from './pages/Imports'

const NAV = [
  { to: '/',          icon: Search,    label: 'Search'    },
  { to: '/discover',  icon: Compass,   label: 'Discover'  },
  { to: '/queue',     icon: Download,  label: 'Queue'     },
  { to: '/library',   icon: Music,     label: 'Library'   },
  { to: '/playlists', icon: ListMusic, label: 'Playlists' },
  { to: '/import',    icon: Import,    label: 'Import'    },
  { to: '/settings',  icon: Settings,  label: 'Settings'  },
]

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-52 bg-gray-950 border-r border-gray-800 flex flex-col shrink-0">
        <div className="px-4 py-5 flex items-center gap-2">
          <Disc3 className="text-honey-400" size={22} />
          <span className="font-bold text-lg text-honey-400 tracking-tight">Meadarr</span>
          <span className="text-gray-600 text-xs ml-auto">🍯</span>
        </div>
        <nav className="flex-1 px-2 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-honey-500/15 text-honey-400 font-medium'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}>
              <Icon size={16} />{label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 text-xs text-gray-600 border-t border-gray-800">
          Meadarr v1.0
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
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
