import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { VendorsSettings } from '../components/settings/VendorsSettings'
import { AlertRulesSettings } from '../components/settings/AlertRulesSettings'

export default function SettingsPage() {
  const location = useLocation()
  const isAlertsSettings = location.pathname.includes('/settings/alerts')
  const isVendorsSettings = location.pathname.includes('/settings/vendors')

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Settings Nav */}
      <nav className="w-full space-y-1 lg:w-48 lg:shrink-0">
        {[
          { to: '/settings', label: 'General', end: true },
          { to: '/settings/alerts', label: 'Alert Rules', end: false },
          { to: '/settings/vendors', label: 'Vendors', end: false },
        ].map((item) => (
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
        {isAlertsSettings ? (
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
