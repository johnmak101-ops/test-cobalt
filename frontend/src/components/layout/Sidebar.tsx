import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useUIStore } from '../../store'
import { useAuth } from '../../hooks/use-auth'
import { useReviewCounts } from '../../hooks/use-review-queue'
import { useAlerts } from '../../hooks/use-alerts'
import { useUnreadCount } from '../../hooks/use-emails'
import { useDocumentCount } from '../../hooks/use-documents'
import { useMediaQuery } from '../../hooks/use-media-query'
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
  FileText,
  X,
} from 'lucide-react'

type BadgeKey = 'pending' | 'unreadAlerts' | 'unreadEmails' | 'documents'

interface NavItem {
  to: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  roles: string[]
  badgeKey: BadgeKey | null
  children?: NavItem[]
}

const EVERYONE = ['COORDINATOR', 'MANAGER', 'ADMIN', 'SUPERADMIN']

const navItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: EVERYONE, badgeKey: null },
  { to: '/shipments', icon: Ship, label: 'Shipments', roles: EVERYONE, badgeKey: null },
  { to: '/purchase-orders', icon: Package, label: 'Customer POs', roles: EVERYONE, badgeKey: null },
  { to: '/documents', icon: FileText, label: 'Documents', roles: EVERYONE, badgeKey: 'documents' },
  { to: '/review-queue', icon: ClipboardCheck, label: 'Review Queue', roles: EVERYONE, badgeKey: 'pending' },
  { to: '/alerts', icon: AlertTriangle, label: 'Alerts', roles: EVERYONE, badgeKey: 'unreadAlerts' },
  // Settings (superadmin) left rail includes Resolution Rules as a sub-tab — no separate main-nav entry.
  { to: '/settings', icon: Settings, label: 'Settings', roles: ['SUPERADMIN'], badgeKey: null },
]

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileNavOpen, closeMobileNav } = useUIStore()
  const { user } = useAuth()
  const { data: reviewCounts } = useReviewCounts()
  const { data: alertsData } = useAlerts()
  const { data: unreadData } = useUnreadCount()
  const documentCount = useDocumentCount()

  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // Collapsed (icon-only rail) is a desktop-only affordance. As an off-canvas
  // drawer the sidebar always shows full labels, so ignore `sidebarCollapsed`
  // until we're actually at lg+.
  const collapsed = sidebarCollapsed && isDesktop

  // Close the drawer once we cross up into desktop (where it becomes the
  // persistent rail) so a stale open state can't leave scroll locked.
  useEffect(() => {
    if (isDesktop && mobileNavOpen) closeMobileNav()
  }, [isDesktop, mobileNavOpen, closeMobileNav])

  // Escape closes the drawer.
  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileNav()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mobileNavOpen, closeMobileNav])

  // Lock body scroll while the drawer overlays content (mobile/tablet only).
  useEffect(() => {
    if (mobileNavOpen && !isDesktop) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [mobileNavOpen, isDesktop])

  const unreadAlerts = alertsData?.alerts?.filter((a) => a.status === 'ACTIVE' && !a.readAt).length ?? 0

  const badges: Record<string, number> = {
    pending: reviewCounts?.provisional ?? 0,
    unreadAlerts,
    unreadEmails: unreadData?.unread ?? 0,
    documents: documentCount,
  }

  const isVisible = (roles: string[]) => !user || roles.includes(user.role)

  const renderBadge = (count: number, isCollapsed: boolean) => {
    if (count <= 0) return null
    if (isCollapsed) {
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
        onClick={closeMobileNav}
        className={({ isActive }) =>
          cn(
            'relative flex items-center rounded-lg text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-0 py-2' : 'gap-3 px-3 py-2',
            indent && !collapsed && 'pl-10',
            isActive
              ? 'bg-cobalt-primary/15 text-cobalt-primary'
              : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary'
          )
        }
      >
        <item.icon size={indent ? 15 : 18} className="shrink-0" />
        {!collapsed && (
          <span className="flex flex-1 items-center justify-between">
            <span className={indent ? 'text-[13px]' : ''}>{item.label}</span>
            {renderBadge(badgeCount, false)}
          </span>
        )}
        {collapsed && renderBadge(badgeCount, true)}
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
    <>
      {/* Backdrop — only rendered while the drawer is open, only below lg. */}
      {mobileNavOpen && (
        <div
          data-testid="mobile-nav-backdrop"
          aria-hidden="true"
          onClick={closeMobileNav}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        />
      )}

      <aside
        id="app-sidebar"
        aria-label="Main navigation"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full flex-col border-r border-border bg-surface-900 transition-all duration-200',
          // Off-canvas drawer width on mobile; rail width at lg+.
          'w-64',
          collapsed ? 'lg:w-16' : 'lg:w-56',
          // Slide in/out below lg; always on-screen at lg+.
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0'
        )}
      >
        {/* Logo + collapse/close controls */}
        <div className={cn(
          'flex h-14 items-center border-b border-border',
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        )}>
          {collapsed ? (
            /* Collapsed (desktop): logo swaps to expand button on hover */
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
              className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-primary transition-colors hover:bg-surface-700"
            >
              <CobaltLogo size={18} color="white" className="transition-opacity group-hover:opacity-0" />
              <PanelLeftOpen size={16} className="absolute text-text-primary opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            /* Expanded: logo + text, then close (mobile) / collapse (desktop) */
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
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={closeMobileNav}
                  aria-label="Close navigation menu"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary lg:hidden"
                >
                  <X size={16} />
                </button>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  aria-label="Collapse sidebar"
                  className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-700 hover:text-text-primary lg:flex"
                >
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {navItems.map(renderItem)}
        </nav>
      </aside>
    </>
  )
}
