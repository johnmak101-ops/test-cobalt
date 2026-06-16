import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { ModeIcon } from '../ui/ModeIcon'
import { PoBadge } from '../shipments/PoBadge'
import { formatRelativeTime, modeLabel } from '../../lib/utils'
import type { Shipment } from '../../hooks/use-shipments'

export function RecentActivityTable({ shipments }: { shipments: Shipment[] }) {
  const navigate = useNavigate()

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Recent Shipment Activity</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-900/50">
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Job / Shipment</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">POs</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Customer</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Route</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Last Activity</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Risk</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => {
              const shortId = s.bookingNo ?? s.id.slice(0, 12)
              return (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/shipments/${s.id}`)}
                  className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <ModeIcon mode={s.mode} size={16} className="shrink-0 text-cobalt-teal" />
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-medium text-cobalt-primary-light">{s.jobNo ?? shortId}</div>
                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                          {s.mode && <span>{modeLabel(s.mode)}</span>}
                          {s.jobNo && shortId && shortId !== s.jobNo && <span className="font-mono">· {shortId}</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <PoBadge shipmentId={s.id} pos={s.linkedPOs ?? []} />
                  </td>
                  <td className="px-5 py-3 text-sm text-text-secondary">{s.customer?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge variant="status" value={s.status} />
                  </td>
                  <td className="px-5 py-3 text-sm text-text-muted">{formatRelativeTime(s.updatedAt)}</td>
                  <td className="px-5 py-3">
                    {s.riskLevel === 'DELAYED' && <AlertTriangle size={16} className="text-status-critical" />}
                    {s.riskLevel === 'AT_RISK' && <AlertTriangle size={16} className="text-status-warning" />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
