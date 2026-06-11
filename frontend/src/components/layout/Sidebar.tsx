import { NavLink } from 'react-router-dom'
import { useUIStore } from '../../store'
import { useAuth } from '../../hooks/use-auth'
import { useReviewCounts } from '../../hooks/use-review-queue'
import { useAlerts } from '../../hooks/use-alerts'
import { useUnreadCount } from '../../hooks/use-emails'
import { cn } from '../../lib/utils'
import { CobaltLogo } from '../ui/CobaltLogo'
import {
  LayoutDashboard,
  Ship,
  AlertTriangle,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardCheck,
  Package,
} from 'lucide-react'

type BadgeKey = 'pending' | 'unreadAlerts' | 'unreadEmails'

interface NavItem {
  to: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  roles: string[]
  badgeKey: BadgeKey | null
  children?: NavItem[]
}

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/shipments', icon: Ship, label: 'Shipments', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/purchase-orders', icon: Package, label: 'Purchase Orders', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: null },
  { to: '/review-queue', icon: ClipboardCheck, label: 'Review Queue', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: 'pending' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts', roles: ['COORDINATOR', 'MANAGER', 'ADMIN'], badgeKey: 'unreadAlerts' },
  { to: '/settings', icon: Settings, label: 'Settings', roles: ['MANAGER', 'ADMIN'], badgeKey: null },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const { user } = useAuth()
  const { data: reviewCounts } = useReviewCounts()
  const { data: alertsData } = useAlerts()
  const { data: unreadData } = useUnreadCount()

  const unreadAlerts = alertsData?.alerts?.filter((a) => a.status === 'ACTIVE' && !a.readAt).length ?? 0

  const badges: Record<string, number> = {
    pending: reviewCounts?.pending ?? 0,
    unreadAlerts,
    unreadEmails: unreadData?.unread ?? 0,
  }

  const isVisible = (roles: string[]) => !user || roles.includes(user.role)

  const renderBadge = (count: number, collapsed: boolean) => {
    if (count <= 0) return null
    if (collapsed) {
      return <span className="absolute right-1 top-0.5 h-2 w-2 rounded-full bg-status-warning" />
    }
    return (
      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-status-warning px-1.5 text-[10px] font-bold text-white">
        {count}
      </span>
    )
  }

  const renderLink = (item: NavItem, indent: boolean = false) => {
    const badgeCount = item.badgeKey ? badges[item.badgeKey] ?? 0 : 0
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          cn(
            'relative flex items-center rounded-lg text-sm font-medium transition-colors',
            sidebarCollapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
            indent && !sidebarCollapsed && 'pl-10',
            isActive
              ? 'bg-cobalt-primary/15 text-cobalt-primary'
              : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary'
          )
        }
      >
        <item.icon size={indent ? 15 : 18} className="shrink-0" />
        {!sidebarCollapsed && (
          <span className="flex flex-1 items-center justify-between">
            <span className={indent ? 'text-[13px]' : ''}>{item.label}</span>
            {renderBadge(badgeCount, false)}
          </span>
        )}
        {sidebarCollapsed && renderBadge(badgeCount, true)}
      </NavLink>
    )
  }

  const renderItem = (item: NavItem) => {
    if (!isVisible(item.roles)) return null
    const children = item.children?.filter((c) => isVisible(c.roles))

    if (!children?.length) return renderLink(item)

    return (
      <div key={item.to} className="space-y-0.5">
        {renderLink(item)}
        {children.map((child) => renderLink(child, true))}
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-full flex-col border-r border-border bg-surface-900 transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo + collapse toggle */}
      <div className={cn(
        'flex h-14 items-center border-b border-border',
        sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
      )}>
        {sidebarCollapsed ? (
          /* Collapsed: logo swaps to expand button on hover */
          <button
            onClick={toggleSidebar}
            className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-primary transition-colors hover:bg-surface-700"
          >
            <CobaltLogo size={18} color="white" className="transition-opacity group-hover:opacity-0" />
            <PanelLeftOpen size={16} className="absolute text-text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ) : (
          /* Expanded: logo + text + collapse button */
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-primary">
                <CobaltLogo size={18} color="white" />
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-bold tracking-tight text-text-primary">
                  COBALT
                </span>
                <span className="text-[11px] font-medium text-text-muted">
                  ShipTrack
                </span>
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

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(renderItem)}
      </nav>
    </aside>
  )
}
