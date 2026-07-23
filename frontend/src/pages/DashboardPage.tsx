import { useDashboard } from '../hooks/use-dashboard'
import { useAlerts } from '../hooks/use-alerts'
import { useShipments } from '../hooks/use-shipments'
import { KPICard } from '../components/dashboard/KPICard'
import { ActiveAlertsTable } from '../components/dashboard/ActiveAlertsTable'
import { ActiveShipmentsTable } from '../components/dashboard/ActiveShipmentsTable'
import { Package, AlertTriangle, AlertCircle, Mail } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function DashboardPage() {
  const { data, isLoading } = useDashboard()
  // Both tables read the SAME endpoints the Alerts and Shipments pages use, filtered client-side.
  // No new API: the dashboard should not be able to disagree with the page it links to.
  const { data: alertsData } = useAlerts()
  const { data: shipmentsData } = useShipments({ status: 'ALL' })
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-text-muted">Loading dashboard...</div>
      </div>
    )
  }

  const stats = data?.stats ?? { activeShipments: 0, warningAlerts: 0, criticalAlerts: 0, newEmails: 0 }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          icon={Package}
          label="Active Shipments"
          value={stats.activeShipments}
          color="bg-cobalt-primary/15 text-cobalt-primary-light"
          onClick={() => navigate('/shipments')}
        />
        <KPICard
          icon={AlertTriangle}
          label="Warning Alerts"
          value={stats.warningAlerts}
          color="bg-status-warning/15 text-status-warning"
          onClick={() => navigate('/alerts?severity=WARNING')}
        />
        <KPICard
          icon={AlertCircle}
          label="Critical Alerts"
          value={stats.criticalAlerts}
          color="bg-status-critical/15 text-status-critical"
          onClick={() => navigate('/alerts?severity=CRITICAL')}
        />
        <KPICard
          icon={Mail}
          label="New Emails"
          value={stats.newEmails}
          color="bg-cobalt-teal/15 text-cobalt-teal"
          onClick={() => navigate('/inbox')}
        />
      </div>

      {/* The "Alerts Requiring Attention" card stack was replaced by ActiveAlertsTable below:
          same rows, but scannable in a grid and consistent with every other list in the app. */}
      <ActiveAlertsTable alerts={alertsData?.alerts ?? []} />

      <ActiveShipmentsTable shipments={shipmentsData?.shipments ?? []} />

      {/* "Today's Cargo Set Sail" is parked, not deleted — it read "No cargo set sail today" on
          most days, which is a whole card spent saying nothing. RecentActivityTable and the
          dashboard's recentActivity payload are untouched; restore by rendering it again. */}
    </div>
  )
}
