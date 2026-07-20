import { NavLink, Navigate, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { useAuth } from '../hooks/use-auth'
import { usePageAccess } from '../hooks/use-page-access'
import { AlertRulesSettings } from '../components/settings/AlertRulesSettings'
import { UsersSettings } from '../components/settings/UsersSettings'
import { AccessControlSettings } from '../components/settings/AccessControlSettings'
import AdminMeshMissesPage from './AdminMeshMissesPage'

export default function SettingsPage() {
  const location = useLocation()
  const { user } = useAuth()
  const { canView } = usePageAccess()
  const isSuper = user?.role === 'SUPERADMIN'
  const isAdmin = isSuper || user?.role === 'ADMIN'
  const isAlertsSettings = location.pathname.includes('/settings/alerts')
  const isUsersSettings = location.pathname.includes('/settings/users')
  const isAccess = location.pathname.includes('/settings/access')
  const isMeshMisses = location.pathname.includes('/settings/mesh-misses')

  // No empty "General" tab — only real config panels. Superadmin-only vs access-matrix tabs.
  // Vendors (#127), Review Policy (#124), and Resolution Rules settings UIs removed.
  const navItems = [
    { to: '/settings/alerts', label: 'Alert Rules', end: false, show: canView('alert_rules') },
    { to: '/settings/users', label: 'Users', end: false, show: isSuper },
    { to: '/settings/access', label: 'Access Control', end: false, show: isSuper },
    { to: '/settings/mesh-misses', label: 'Mesh misses', end: false, show: isAdmin },
  ].filter((i) => i.show)

  // /settings alone had no content — send to the first tab the user can open.
  const atSettingsRoot =
    location.pathname === '/settings' || location.pathname === '/settings/'
  if (atSettingsRoot) {
    const dest = navItems[0]?.to
    if (dest) return <Navigate to={dest} replace />
    return (
      <p className="text-sm text-text-muted">No settings pages available for your role.</p>
    )
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
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
                  : 'text-text-secondary hover:bg-surface-700 hover:text-text-primary',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1">
        {isAccess ? (
          <AccessControlSettings />
        ) : isUsersSettings ? (
          <UsersSettings />
        ) : isAlertsSettings ? (
          <AlertRulesSettings />
        ) : isMeshMisses ? (
          <AdminMeshMissesPage />
        ) : (
          <Navigate to={navItems[0]?.to ?? '/'} replace />
        )}
      </div>
    </div>
  )
}
