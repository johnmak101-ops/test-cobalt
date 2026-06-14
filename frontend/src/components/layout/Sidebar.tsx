import { NavLink } from 'react-router-dom'
import { useUIStore } from '../../store'
import { useAuth } from '../../hooks/use-auth'
import { cn } from '../../lib/utils'
import { CobaltLogo } from '../ui/CobaltLogo'
import { LayoutDashboard, Package, AlertTriangle, ClipboardCheck, Settings, Users, PanelLeftClose, PanelLeftOpen } from 'lucide-react'

const baseNav = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/bookings', icon: Package, label: 'Bookings', end: false },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts', end: false },
]

const RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, SUPERADMIN: 3 }

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user } = useAuth()
  const rank = RANK[user?.role ?? ''] ?? -1
  const navItems = [
    ...baseNav,
    ...(rank >= 1 ? [{ to: '/review', icon: ClipboardCheck, label: 'Review', end: false }] : []),
    ...(rank >= 2 ? [{ to: '/settings', icon: Settings, label: 'Settings', end: false }] : []),
    ...(rank >= 3 ? [{ to: '/users', icon: Users, label: 'Users', end: false }] : []),
  ]

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-full flex-col border-r border-border bg-surface-900 transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-border',
          sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4',
        )}
      >
        {sidebarCollapsed ? (
          <button
            onClick={toggleSidebar}
            className="group relative flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-primary hover:bg-surface-700"
          >
            <CobaltLogo size={18} color="white" className="transition-opacity group-hover:opacity-0" />
            <PanelLeftOpen size={16} className="absolute text-text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-primary">
                <CobaltLogo size={18} color="white" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold tracking-tight text-text-primary">COBALT</span>
                <span className="text-[11px] font-medium text-text-muted">ShipTrack</span>
              </div>
            </div>
            <button
              onClick={toggleSidebar}
              className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-700 hover:text-text-primary"
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'relative flex items-center rounded-lg text-sm font-medium transition-colors',
                sidebarCollapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
                isActive
                  ? 'bg-cobalt-primary/15 text-cobalt-primary'
                  : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary',
              )
            }
          >
            <item.icon size={18} className="shrink-0" />
            {!sidebarCollapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
