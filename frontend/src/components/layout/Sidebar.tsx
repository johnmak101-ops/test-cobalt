import { NavLink } from 'react-router-dom'
import { useUIStore } from '../../store'
import { useAuth } from '../../hooks/use-auth'
import { useReviewCounts } from '../../hooks/use-review-queue'
import { cn } from '../../lib/utils'
import { CobaltLogo } from '../ui/CobaltLogo'
import {
  LayoutDashboard,
  Ship,
  Mail,
  AlertTriangle,
  Settings,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Package,
} from 'lucide-react'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/shipments', icon: Ship, label: 'Shipments', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/purchase-orders', icon: Package, label: 'Purchase Orders', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/inbox', icon: Mail, label: 'Inbox', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/review-queue', icon: ClipboardCheck, label: 'Review Queue', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: 'pending' as const },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/settings', icon: Settings, label: 'Settings', roles: ['MANAGER', 'ADMIN'], badgeKey: null },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user } = useAuth()
  const { data: reviewCounts } = useReviewCounts()

  const visibleItems = navItems.filter(
    (item) => !user || item.roles.includes(user.role)
  )

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-full flex-col border-r border-border bg-surface-900 transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-primary">
          <CobaltLogo size={18} color="white" />
        </div>
        {!sidebarCollapsed && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-bold tracking-tight text-text-primary">
              COBALT
            </span>
            <span className="text-[11px] font-medium text-text-muted">
              ShipTrack
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {visibleItems.map(({ to, icon: Icon, label, badgeKey }) => {
          const badgeCount = badgeKey && reviewCounts ? reviewCounts[badgeKey] : 0

          return (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-cobalt-primary/15 text-cobalt-primary'
                    : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary'
                )
              }
            >
              <Icon size={18} className="shrink-0" />
              {!sidebarCollapsed && (
                <span className="flex flex-1 items-center justify-between">
                  {label}
                  {badgeCount > 0 && (
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-status-warning px-1.5 text-[10px] font-bold text-white">
                      {badgeCount}
                    </span>
                  )}
                </span>
              )}
              {sidebarCollapsed && badgeCount > 0 && (
                <span className="absolute right-1 top-0.5 h-2 w-2 rounded-full bg-status-warning" />
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex h-10 items-center justify-center border-t border-border text-text-muted hover:text-text-primary"
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  )
}
