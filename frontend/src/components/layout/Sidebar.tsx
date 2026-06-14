import { NavLink } from 'react-router-dom'
import { useUIStore } from '../../store'
import { useAuth } from '../../hooks/use-auth'
import { useReviewQueue } from '../../hooks/use-review'
import { useAlerts } from '../../hooks/use-alerts'
import { cn } from '../../lib/utils'
import { CobaltLogo } from '../ui/CobaltLogo'
import {
  LayoutDashboard,
  Ship,
  Package,
  ClipboardCheck,
  AlertTriangle,
  Settings,
  Database,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'

const RANK: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2, SUPERADMIN: 3 }

type BadgeKey = 'review' | 'alerts'
interface NavItem {
  to: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  minRank: number
  badge?: BadgeKey
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', minRank: 0 },
  { to: '/shipments', icon: Ship, label: 'Shipments', minRank: 0 },
  { to: '/purchase-orders', icon: Package, label: 'Purchase Orders', minRank: 0 },
  { to: '/review-queue', icon: ClipboardCheck, label: 'Review Queue', minRank: 1, badge: 'review' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts', minRank: 0, badge: 'alerts' },
  { to: '/settings', icon: Settings, label: 'Settings', minRank: 2 },
  { to: '/masters', icon: Database, label: 'Master Data', minRank: 2 },
  { to: '/users', icon: Users, label: 'Users', minRank: 3 },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user } = useAuth()
  const rank = RANK[user?.role ?? ''] ?? -1
  const { data: reviewItems } = useReviewQueue()
  const { data: alerts } = useAlerts('ACTIVE')
  const badges: Record<BadgeKey, number> = { review: reviewItems?.length ?? 0, alerts: alerts?.length ?? 0 }

  const renderBadge = (count: number, collapsed: boolean) => {
    if (count <= 0) return null
    if (collapsed) return <span className="absolute right-1 top-0.5 h-2 w-2 rounded-full bg-status-warning" />
    return (
      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-status-warning px-1.5 text-[10px] font-bold text-white">
        {count}
      </span>
    )
  }

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
            className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-primary transition-colors hover:bg-surface-700"
          >
            <CobaltLogo size={18} color="white" className="transition-opacity group-hover:opacity-0" />
            <PanelLeftOpen size={16} className="absolute text-text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-primary">
                <CobaltLogo size={18} color="white" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold tracking-tight text-text-primary">COBALT</span>
                <span className="text-[11px] font-medium text-text-muted">ShipTrack</span>
              </div>
            </div>
            <button
              onClick={toggleSidebar}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary"
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems
          .filter((item) => rank >= item.minRank)
          .map((item) => {
            const count = item.badge ? badges[item.badge] : 0
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
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
                {!sidebarCollapsed && (
                  <span className="flex flex-1 items-center justify-between">
                    <span>{item.label}</span>
                    {renderBadge(count, false)}
                  </span>
                )}
                {sidebarCollapsed && renderBadge(count, true)}
              </NavLink>
            )
          })}
      </nav>
    </aside>
  )
}
