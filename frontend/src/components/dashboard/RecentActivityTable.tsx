import { Badge } from '../ui/Badge'
import { parsePONumbers, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'

interface Shipment {
  id: string
  poNumbers: string
  status: string
  riskLevel: string
  route: string | null
  updatedAt: string
  customer: { name: string } | null
  forwarder: { name: string } | null
}

interface RecentActivityTableProps {
  shipments: Shipment[]
}

export function RecentActivityTable({ shipments }: RecentActivityTableProps) {
  const navigate = useNavigate()

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Recent Shipment Activity</h3>
      </div>
      <div className="overflow-x-auto">
        {/* PO# takes the leftover width (w-full); Status/Last Activity shrink to content (w-0 + nowrap) so
            they never stretch past their longest label — #116 */}
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-900/50">
              <th className="w-full px-5 py-2.5 text-left text-xs font-medium text-text-muted">PO#</th>
              <th className="whitespace-nowrap px-5 py-2.5 text-left text-xs font-medium text-text-muted">Customer</th>
              <th className="whitespace-nowrap px-5 py-2.5 text-left text-xs font-medium text-text-muted">Route</th>
              <th className="w-0 whitespace-nowrap px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
              <th className="w-0 whitespace-nowrap px-5 py-2.5 text-left text-xs font-medium text-text-muted">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/shipments/${s.id}`)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700"
              >
                <td className="w-full px-5 py-3 font-mono text-sm text-text-primary">
                  {parsePONumbers(s.poNumbers).join(', ')}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-sm text-text-secondary">
                  {s.customer?.name ?? '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                <td className="w-0 whitespace-nowrap px-5 py-3">
                  <Badge variant="status" value={s.status} />
                </td>
                <td className="w-0 whitespace-nowrap px-5 py-3 text-sm text-text-muted">
                  {formatRelativeTime(s.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
