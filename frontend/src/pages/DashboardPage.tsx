import { Link } from 'react-router-dom'
import { Package, Ship, AlertOctagon, TriangleAlert, ChevronRight } from 'lucide-react'
import { useBookings } from '../hooks/use-tracking'
import { useAlerts } from '../hooks/use-alerts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { StateBadge } from '../components/StateBadge'
import { ModeIcon } from '../components/ui/ModeIcon'

export default function DashboardPage() {
  const { data: bookings = [] } = useBookings()
  const { data: alerts = [] } = useAlerts('ACTIVE')
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length
  const warnings = alerts.filter((a) => a.severity === 'WARNING').length
  const activeLegs = bookings.reduce((n, b) => n + (b.legCount ?? 0), 0)

  const kpis = [
    { label: 'Bookings', value: bookings.length, icon: Package, color: 'text-cobalt-primary' },
    { label: 'Legs', value: activeLegs, icon: Ship, color: 'text-cobalt-teal' },
    { label: 'Critical', value: critical, icon: AlertOctagon, color: 'text-status-critical' },
    { label: 'Warnings', value: warnings, icon: TriangleAlert, color: 'text-status-warning' },
  ]

  return (
    <div className="space-y-6">
      <h1 className="page-title">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl font-bold">{k.value}</div>
                <div className="text-sm text-text-muted">{k.label}</div>
              </div>
              <k.icon className={k.color} size={22} />
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Recent bookings</h2>
            <Link to="/bookings" className="link inline-flex items-center gap-0.5 text-xs">View all<ChevronRight size={12} /></Link>
          </div>
          <div className="space-y-1">
            {bookings.slice(0, 7).map((b) => (
              <Link
                key={b.id}
                to={`/bookings/${b.id}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-surface-700"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm text-text-primary">{b.jobNo}</span>
                  {b.activeMode && <ModeIcon mode={b.activeMode} />}
                  <span className="text-xs text-text-muted">{b.brand ?? ''}</span>
                </span>
                {b.activeState && <StateBadge state={b.activeState} />}
              </Link>
            ))}
            {!bookings.length && (
              <div className="px-3 py-2 muted">No bookings yet — run Reconcile to import shipments.</div>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Active alerts</h2>
            <Link to="/alerts" className="link inline-flex items-center gap-0.5 text-xs">View all<ChevronRight size={12} /></Link>
          </div>
          <div className="space-y-1">
            {alerts.slice(0, 7).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg px-3 py-2">
                <span className="flex items-center gap-2">
                  <Badge variant="severity" value={a.severity} />
                  <span className="text-sm text-text-secondary">{a.message}</span>
                </span>
                <span className="font-mono text-xs text-text-muted">{a.ruleId}</span>
              </div>
            ))}
            {!alerts.length && (
              <div className="px-3 py-2 muted">No active alerts — run Evaluate alerts to check.</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
