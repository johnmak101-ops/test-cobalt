import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { formatDate, formatRelativeTime, parsePONumbers } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'
import type { Alert } from '../../hooks/use-alerts'

/**
 * Active alerts on the dashboard.
 *
 * ACTIVE only, and snoozed rows are excluded: a snooze is a human saying "not now", so showing it
 * here would re-nag with the thing they just parked. Dismissed/resolved never carry status ACTIVE.
 * Rows deep-link to the shipment, because every alert is answered by looking at one.
 */
export function ActiveAlertsTable({ alerts }: { alerts: Alert[] }) {
  const navigate = useNavigate()
  const now = Date.now()
  const active = alerts
    .filter((a) => a.status === 'ACTIVE')
    .filter((a) => !a.snoozedUntil || new Date(a.snoozedUntil).getTime() <= now)
    // Worst first, then newest — an operator reads top-down and should hit CRITICAL first.
    .sort((a, b) => {
      const rank = (s: string) => (s === 'CRITICAL' ? 0 : s === 'WARNING' ? 1 : 2)
      const d = rank(a.severity) - rank(b.severity)
      if (d !== 0) return d
      return (b.triggeredAt ?? '') < (a.triggeredAt ?? '') ? -1 : 1
    })

  return (
    <div className="max-w-full overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-text-primary">
          Active Alerts
          {active.length > 0 && <span className="ml-2 text-xs font-normal text-text-muted">· {active.length}</span>}
        </h3>
        <button
          type="button"
          onClick={() => navigate('/alerts')}
          className="text-xs font-medium text-cobalt-primary-light hover:underline"
        >
          View All
        </button>
      </div>
      {active.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted">No active alerts.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] table-fixed">
            <thead>
              <tr className="border-b border-border bg-surface-900/50">
                <th className="w-[7rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Severity</th>
                <th className="w-[38%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Alert</th>
                <th className="w-[22%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Shipment</th>
                <th className="w-[7.5rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Fired</th>
              </tr>
            </thead>
            <tbody>
              {active.map((a) => {
                const pos = parsePONumbers(a.shipment?.poNumbers ?? '[]')
                const ship = pos.length > 0 ? pos.slice(0, 2).join(', ') : (a.shipment?.route ?? '—')
                return (
                  <tr
                    key={a.id}
                    {...interactiveProps(() => navigate(`/shipments/${a.shipmentId}`))}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700"
                  >
                    <td className="px-5 py-3">
                      <Badge variant="severity" value={a.severity} />
                    </td>
                    <td className="min-w-0 max-w-0 px-5 py-3 text-sm text-text-secondary">
                      <span className="block truncate" title={a.message}>
                        {a.message}
                      </span>
                    </td>
                    <td className="min-w-0 max-w-0 px-5 py-3 text-sm text-text-secondary">
                      <span className="block truncate font-mono text-xs" title={ship}>
                        {ship}
                      </span>
                      {a.shipment?.customer?.name && (
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted">
                          {a.shipment.customer.name}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm text-text-muted">
                      {a.triggeredAt ? (
                        <span title={formatRelativeTime(a.triggeredAt)}>{formatDate(a.triggeredAt)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
