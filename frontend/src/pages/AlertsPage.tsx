import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAlerts, useDismissAlert, useEvaluateAlerts, useResolveAlert, useSnoozeAlert } from '../hooks/use-alerts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

const GROUPS = ['CRITICAL', 'WARNING', 'INFO'] as const

export default function AlertsPage() {
  const { data: alerts = [] } = useAlerts('ACTIVE')
  const dismiss = useDismissAlert()
  const resolve = useResolveAlert()
  const snooze = useSnoozeAlert()
  const evaluate = useEvaluateAlerts()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Alerts</h1>
        <button onClick={() => evaluate.mutate()} disabled={evaluate.isPending} className="btn btn-accent">
          Evaluate now
        </button>
      </div>

      {GROUPS.map((sev) => {
        const items = alerts.filter((a) => a.severity === sev)
        if (!items.length) return null
        return (
          <div key={sev}>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="severity" value={sev} />
              <span className="text-sm text-text-muted">{items.length}</span>
            </div>
            <Card padding={false}>
              {items.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between border-b border-border/50 px-5 py-3 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-text-muted">{a.ruleId}</span>
                    <span className="text-sm text-text-primary">{a.message}</span>
                    {a.bookingId && (
                      <Link
                        to={`/bookings/${a.bookingId}`}
                        className="link inline-flex items-center gap-0.5 text-xs"
                      >
                        Booking<ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <button
                      onClick={() => resolve.mutate(a.id)}
                      disabled={resolve.isPending}
                      className="text-text-muted hover:text-status-success disabled:opacity-50"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => snooze.mutate(a.id)}
                      disabled={snooze.isPending}
                      className="text-text-muted hover:text-text-primary disabled:opacity-50"
                    >
                      Snooze 24h
                    </button>
                    <button
                      onClick={() => dismiss.mutate(a.id)}
                      disabled={dismiss.isPending}
                      className="text-text-muted hover:text-status-critical disabled:opacity-50"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )
      })}

      {!alerts.length && (
        <Card>
          <div className="muted">No active alerts. Click "Evaluate now" to run the alert rules.</div>
        </Card>
      )}
    </div>
  )
}
