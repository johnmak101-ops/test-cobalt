import { useDashboard } from '../hooks/use-dashboard'
import { useAlerts } from '../hooks/use-alerts'
import { useShipments } from '../hooks/use-shipments'
import { useReviewCounts, useReviewQueue } from '../hooks/use-review-queue'
import { KPICard } from '../components/dashboard/KPICard'
import { ActiveAlertsPanel } from '../components/dashboard/ActiveAlertsPanel'
import { ActiveShipmentsTable } from '../components/dashboard/ActiveShipmentsTable'
import { ReviewQueuePanel } from '../components/dashboard/ReviewQueuePanel'
import { ShipmentPipelineCard } from '../components/dashboard/ShipmentPipelineCard'
import { Package, AlertTriangle, AlertCircle, ClipboardCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export default function DashboardPage() {
  const { data, isLoading } = useDashboard()
  // Every panel reads the SAME endpoints the page it links to reads, filtered client-side.
  // No new API: the dashboard should not be able to disagree with the page it links to. The pipeline
  // counts `useShipments` for the same reason, and the Review Queue count comes from the counts
  // endpoint the sidebar badge already polls, so card and badge cannot show different numbers.
  const { data: alertsData } = useAlerts()
  const { data: shipmentsData } = useShipments({ status: 'ALL' })
  const { data: reviewCounts } = useReviewCounts()
  const { data: reviewQueue } = useReviewQueue('active')
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
        {/* Was "New Emails" → /inbox. Unread mail is an INPUT nobody acts on directly; the queue is
            where the work actually is, and it is the number already on the sidebar badge. Same slot,
            same teal, pointed at the desk. */}
        <KPICard
          icon={ClipboardCheck}
          label="Review Queue"
          value={reviewCounts?.provisional ?? 0}
          color="bg-cobalt-teal/15 text-cobalt-teal"
          onClick={() => navigate('/review-queue')}
        />
      </div>

      <ShipmentPipelineCard shipments={shipmentsData?.shipments ?? []} />

      {/* Alerts and the review desk are both "what needs a person", so they sit side by side rather
          than stacked — and both cap their rows so the two cards stay level however long one list's
          content runs. Single column below lg: at that width two lists side by side truncate to
          uselessness. */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <ActiveAlertsPanel alerts={alertsData?.alerts ?? []} maxCards={3} framed />
        <ReviewQueuePanel shipments={reviewQueue?.shipments ?? []} />
      </div>

      <ActiveShipmentsTable shipments={shipmentsData?.shipments ?? []} />

      {/* "Today's Cargo Set Sail" is parked, not deleted — it read "No cargo set sail today" on
          most days, which is a whole card spent saying nothing. RecentActivityTable and the
          dashboard's recentActivity payload are untouched; restore by rendering it again. */}
    </div>
  )
}
