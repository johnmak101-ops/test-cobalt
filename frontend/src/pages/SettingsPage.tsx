import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { useAuth } from '../hooks/use-auth'
import { usePageAccess } from '../hooks/use-page-access'
import { VendorsSettings } from '../components/settings/VendorsSettings'
import { AlertRulesSettings } from '../components/settings/AlertRulesSettings'
import { UsersSettings } from '../components/settings/UsersSettings'
import { ResolutionRulesSettings } from '../components/settings/ResolutionRulesSettings'

export default function SettingsPage() {
  const location = useLocation()
  const { user } = useAuth()
  const { canView } = usePageAccess()
  const isSuper = user?.role === 'SUPERADMIN'
  const isAlertsSettings = location.pathname.includes('/settings/alerts')
  const isVendorsSettings = location.pathname.includes('/settings/vendors')
  const isUsersSettings = location.pathname.includes('/settings/users')
  const isResolution = location.pathname.includes('/settings/resolution')

  // General / Vendors / Users stay superadmin-only; Alert Rules & Resolution Rules follow the
  // configurable Access Control matrix (shown when the user has at least View on that page).
  const navItems = [
    { to: '/settings', label: 'General', end: true, show: isSuper },
    { to: '/settings/alerts', label: 'Alert Rules', end: false, show: canView('alert_rules') },
    { to: '/settings/vendors', label: 'Vendors', end: false, show: isSuper },
    { to: '/settings/users', label: 'Users', end: false, show: isSuper },
    { to: '/settings/resolution', label: 'Resolution Rules', end: false, show: canView('resolution_rules') },
  ].filter((i) => i.show)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Settings Nav */}
      <nav className="w-full space-y-1 lg:w-48 lg:shrink-0">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'block rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-cobalt-primary/15 text-cobalt-primary'
                  : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary'
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Settings Content */}
      <div className="flex-1">
        {isResolution ? (
          <ResolutionRulesSettings />
        ) : isUsersSettings ? (
          <UsersSettings />
        ) : isAlertsSettings ? (
          <AlertRulesSettings />
        ) : isVendorsSettings ? (
          <VendorsSettings />
        ) : (
          <div>
            <h2 className="text-base font-semibold text-text-primary">General Settings</h2>
            <p className="mt-2 text-sm text-text-secondary">
              Manage alert rules and vendors from the tabs on the left. Email ingestion is configured
              on the server (via GRAPH_* environment variables), not in the app.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
