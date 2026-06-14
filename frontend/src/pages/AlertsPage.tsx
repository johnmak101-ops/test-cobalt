import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAlerts, useDismissAlert, useEvaluateAlerts } from '../hooks/use-alerts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

const GROUPS = ['CRITICAL', 'WARNING', 'INFO'] as const

export default function AlertsPage() {
  const { data: alerts = [] } = useAlerts('ACTIVE')
  const dismiss = useDismissAlert()
  const evaluate = useEvaluateAlerts()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Alerts</h1>
        <button
          onClick={() => evaluate.mutate()}
          disabled={evaluate.isPending}
          className="rounded-lg border border-cobalt-primary/40 bg-cobalt-primary/15 px-3 py-1.5 text-sm font-medium text-cobalt-primary hover:bg-cobalt-primary/25 disabled:opacity-50"
        >
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
                        className="inline-flex items-center gap-0.5 text-xs text-cobalt-primary hover:underline"
                      >
                        Booking<ChevronRight size={12} />
                      </Link>
                    )}
                  </div>
                  <button
                    onClick={() => dismiss.mutate(a.id)}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </Card>
          </div>
        )
      })}

      {!alerts.length && (
        <Card>
          <div className="text-sm text-text-muted">No active alerts. Click "Evaluate now" to run the alert rules.</div>
        </Card>
      )}
    </div>
  )
}
