import { useNavigate } from 'react-router-dom'
import { AlertCard } from '../alerts/AlertCard'
import type { Alert } from '../../hooks/use-alerts'

/** How many cards the dashboard shows before deferring to the Alerts page. */
const MAX_CARDS = 5

/**
 * The alerts that are live *right now*, worst-first then newest.
 *
 * ACTIVE only, and snoozed rows are excluded: a snooze is a human saying "not now", so showing it
 * here would re-nag with the thing they just parked. Dismissed/resolved never carry status ACTIVE.
 *
 * A module function, not inline in the component: reading the clock during render is impure
 * (react-hooks/purity), and the same convention already holds for formatRelativeTime. The clock is
 * only compared against snooze deadlines measured in hours, so the 60s /alerts refetch is ample
 * resolution — an expiring snooze surfaces on the next poll.
 */
export function selectLiveAlerts(alerts: Alert[]): Alert[] {
  const now = Date.now()
  return alerts
    .filter((a) => a.status === 'ACTIVE')
    .filter((a) => !a.snoozedUntil || new Date(a.snoozedUntil).getTime() <= now)
    // Worst first, then newest — an operator reads top-down and should hit CRITICAL first.
    .sort((a, b) => {
      const rank = (s: string) => (s === 'CRITICAL' ? 0 : s === 'WARNING' ? 1 : 2)
      const d = rank(a.severity) - rank(b.severity)
      if (d !== 0) return d
      return (b.triggeredAt ?? '') < (a.triggeredAt ?? '') ? -1 : 1
    })
}

/**
 * Active alerts on the dashboard, as the compact AlertCard stack.
 *
 * Cards, not a table: an alert is a thing to ACT on, and the card carries the severity as a coloured
 * left edge, the unread dot, and the full message on its own line — none of which survives being
 * squeezed into a truncating grid cell. AlertCard is the same component the Alerts page renders, so
 * the two cannot drift. Which alerts qualify is selectLiveAlerts's call.
 */
export function ActiveAlertsPanel({ alerts }: { alerts: Alert[] }) {
  const navigate = useNavigate()
  const active = selectLiveAlerts(alerts)
  const shown = active.slice(0, MAX_CARDS)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary">
          Active Alerts
          {active.length > 0 && (
            <span className="ml-2 text-xs font-normal text-text-muted">· {active.length}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => navigate('/alerts')}
          className="shrink-0 text-xs font-medium text-cobalt-primary-light hover:underline"
        >
          {/* Name the truncation: the heading count vs 5 cards must not read as "that's all". */}
          {active.length > shown.length ? `View All (${active.length})` : 'View All'}
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-text-muted">No active alerts.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => (
            <AlertCard key={a.id} alert={a} compact />
          ))}
        </div>
      )}
    </div>
  )
}
