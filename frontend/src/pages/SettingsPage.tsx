import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../lib/utils'
import { VendorsSettings } from '../components/settings/VendorsSettings'
import { AlertRulesSettings } from '../components/settings/AlertRulesSettings'
import { EmailIntegrationSettings } from '../components/settings/EmailIntegrationSettings'

export default function SettingsPage() {
  const location = useLocation()
  const isAlertsSettings = location.pathname.includes('/settings/alerts')
  const isVendorsSettings = location.pathname.includes('/settings/vendors')
  const isEmailSettings = location.pathname.includes('/settings/email')

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Settings Nav */}
      <nav className="w-full space-y-1 lg:w-48 lg:shrink-0">
        {[
          { to: '/settings', label: 'General', end: true },
          { to: '/settings/email', label: 'Email Integration', end: false },
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
        {isEmailSettings ? (
          <EmailIntegrationSettings />
        ) : isAlertsSettings ? (
          <AlertRulesSettings />
        ) : isVendorsSettings ? (
          <VendorsSettings />
        ) : (
          <div>
            <h2 className="text-base font-semibold text-text-primary">General Settings</h2>
            <p className="mt-2 text-sm text-text-secondary">
              Application settings will be configured here. Email connection, user management,
              and API configuration will be available in future updates.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
