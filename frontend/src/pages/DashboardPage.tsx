import { Link, useNavigate } from 'react-router-dom'
import { Package, AlertTriangle, AlertCircle, ClipboardCheck } from 'lucide-react'
import { useShipments } from '../hooks/use-shipments'
import { useAlerts } from '../hooks/use-alerts'
import { useReviewQueue } from '../hooks/use-review'
import { KPICard } from '../components/dashboard/KPICard'
import { RecentActivityTable } from '../components/dashboard/RecentActivityTable'
import { Badge } from '../components/ui/Badge'

const borderFor: Record<string, string> = {
  CRITICAL: 'border-l-status-critical',
  WARNING: 'border-l-status-warning',
  INFO: 'border-l-status-info',
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data: shipData, isLoading } = useShipments()
  const { data: alerts = [] } = useAlerts('ACTIVE')
  const { data: review = [] } = useReviewQueue()

  const shipments = shipData?.shipments ?? []
  const atRisk = shipments.filter((s) => s.riskLevel === 'AT_RISK' || s.riskLevel === 'DELAYED').length
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length
  const recent = [...shipments].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 8)

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-sm text-text-muted">Loading dashboard...</div>
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard icon={Package} label="Active Shipments" value={shipments.length} color="bg-cobalt-primary/15 text-cobalt-primary-light" onClick={() => navigate('/shipments')} />
        <KPICard icon={AlertTriangle} label="At Risk" value={atRisk} color="bg-status-warning/15 text-status-warning" onClick={() => navigate('/shipments')} />
        <KPICard icon={AlertCircle} label="Critical Alerts" value={critical} color="bg-status-critical/15 text-status-critical" onClick={() => navigate('/alerts')} />
        <KPICard icon={ClipboardCheck} label="Pending Review" value={review.length} color="bg-cobalt-teal/15 text-cobalt-teal" onClick={() => navigate('/review-queue')} />
      </div>

      {alerts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">Alerts Requiring Attention</h2>
            <Link to="/alerts" className="text-xs font-medium text-cobalt-primary-light hover:underline">
              View All
            </Link>
          </div>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((a) => (
              <div
                key={a.id}
                onClick={() => a.bookingId && navigate(`/bookings/${a.bookingId}`)}
                className={`cursor-pointer rounded-lg border border-border border-l-4 bg-surface-800 p-3 transition-colors hover:bg-surface-700 ${borderFor[a.severity] ?? 'border-l-border'}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="severity" value={a.severity} />
                  <span className="font-mono text-xs text-text-muted">{a.ruleId}</span>
                </div>
                <p className="mt-1.5 text-sm text-text-secondary">{a.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && <RecentActivityTable shipments={recent} />}
    </div>
  )
}
