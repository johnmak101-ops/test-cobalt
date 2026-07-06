import { useDashboard } from '../hooks/use-dashboard'
import { KPICard } from '../components/dashboard/KPICard'
import { RecentActivityTable } from '../components/dashboard/RecentActivityTable'
import { AlertCard } from '../components/alerts/AlertCard'
import { Package, AlertTriangle, AlertCircle, Mail } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function DashboardPage() {
  const { data, isLoading } = useDashboard()
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-text-muted">Loading dashboard...</div>
      </div>
    )
  }

  const stats = data?.stats ?? { activeShipments: 0, atRiskShipments: 0, criticalAlerts: 0, newEmails: 0 }

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
          label="At Risk"
          value={stats.atRiskShipments}
          color="bg-status-warning/15 text-status-warning"
          onClick={() => navigate('/alerts')}
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

      {/* Alerts Requiring Attention */}
      {data?.recentAlerts && data.recentAlerts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary">
              Alerts Requiring Attention
            </h2>
            <button
              onClick={() => navigate('/alerts')}
              className="text-xs font-medium text-cobalt-primary-light hover:underline"
            >
              View All
            </button>
          </div>
          <div className="space-y-2">
            {data.recentAlerts.slice(0, 5).map((alert) => (
              <AlertCard key={alert.id} alert={alert} compact />
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {data?.recentActivity && data.recentActivity.length > 0 && (
        <RecentActivityTable shipments={data.recentActivity} />
      )}
    </div>
  )
}
