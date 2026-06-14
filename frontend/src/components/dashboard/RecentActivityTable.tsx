import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { formatRelativeTime } from '../../lib/utils'
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
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Shipment ID</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Customer</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Route</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
              <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/shipments/${s.id}`)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700"
              >
                <td className="px-5 py-3 font-mono text-sm text-cobalt-primary-light">{s.bookingNo ?? s.id.slice(0, 8)}</td>
                <td className="px-5 py-3 text-sm text-text-secondary">{s.customer?.name ?? '—'}</td>
                <td className="px-5 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                <td className="px-5 py-3">
                  <Badge variant="status" value={s.status} />
                </td>
                <td className="px-5 py-3 text-sm text-text-muted">{formatRelativeTime(s.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
