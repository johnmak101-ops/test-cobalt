import { Badge } from '../ui/Badge'
import { parsePONumbers, formatShortDate, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import type { Shipment } from '../../hooks/use-shipments'

interface ShipmentTableProps {
  shipments: Shipment[]
}

export function ShipmentTable({ shipments }: ShipmentTableProps) {
  const navigate = useNavigate()

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-900/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">PO#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Forwarder</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Route</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">ETD</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">ETA</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Last Activity</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Risk</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/shipments/${s.id}`)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700 transition-colors"
              >
                <td className="px-4 py-3 font-mono text-sm font-medium text-cobalt-primary-light">
                  {parsePONumbers(s.poNumbers).join(', ')}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">
                  {s.customer?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">
                  {s.forwarder?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge variant="status" value={s.status} />
                </td>
                <td className="px-4 py-3 text-sm text-text-secondary">{formatShortDate(s.etd)}</td>
                <td className="px-4 py-3 text-sm text-text-secondary">{formatShortDate(s.eta)}</td>
                <td className="px-4 py-3 text-sm text-text-muted">
                  {formatRelativeTime(s.updatedAt)}
                </td>
                <td className="px-4 py-3">
                  {s.riskLevel === 'DELAYED' && (
                    <AlertTriangle size={16} className="text-status-critical" />
                  )}
                  {s.riskLevel === 'AT_RISK' && (
                    <AlertTriangle size={16} className="text-status-warning" />
                  )}
                </td>
              </tr>
            ))}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-text-muted">
                  No shipments found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
