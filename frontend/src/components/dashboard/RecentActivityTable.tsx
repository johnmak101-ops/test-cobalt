import { Badge } from '../ui/Badge'
import { parsePONumbers, formatRelativeTime, formatDate, formatShipmentId } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { interactiveProps } from '../../lib/interactive'

interface Shipment {
  id: string
  poNumbers: string
  status: string
  riskLevel: string
  route: string | null
  updatedAt: string
  bookingNo?: string | null
  etd?: string | null
  actualDeparture?: string | null
  /** #350: anchor fields for the derived Shipment ID (firstEmailAt ?? createdAt). */
  firstEmailAt?: string | null
  createdAt: string
  customer: { name: string } | null
  forwarder: { name: string } | null
}

interface RecentActivityTableProps {
  shipments: Shipment[]
}

/** Dashboard list of cargo that set sail today (ATD / sailed ETD). */
export function RecentActivityTable({ shipments }: RecentActivityTableProps) {
  const navigate = useNavigate()

  return (
    <div className="max-w-full overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Today&apos;s Cargo Set Sail</h3>
      </div>
      {shipments.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted">No cargo set sail today.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] table-fixed">
            <thead>
              <tr className="border-b border-border bg-surface-900/50">
                <th className="w-[22%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Shipment ID</th>
                <th className="w-[24%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Customer</th>
                <th className="w-[16%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Route</th>
                <th className="w-[8.5rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
                <th className="w-[7.5rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Sailed</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const pos = parsePONumbers(s.poNumbers)
                const poLabel = pos.length > 0 ? pos.slice(0, 3).join(', ') + (pos.length > 3 ? ` +${pos.length - 3}` : '') : null
                // #348/#350: same derived identity as every other surface; booking/PO is the reference line.
                const shipmentId = formatShipmentId(s.id, s.firstEmailAt ?? s.createdAt)
                const booking = s.bookingNo?.trim() || null
                const reference = booking || poLabel
                const sailedAt = s.actualDeparture || s.etd
                return (
                  <tr
                    key={s.id}
                    {...interactiveProps(() => navigate(`/shipments/${s.id}`))}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700"
                  >
                    <td className="min-w-0 max-w-0 px-5 py-3">
                      <span
                        className="block truncate font-mono text-sm font-medium text-cobalt-primary-light"
                        title={shipmentId}
                      >
                        {shipmentId}
                      </span>
                      {reference && (
                        <span
                          className="mt-0.5 block truncate font-mono text-[11px] text-text-muted"
                          title={[booking, poLabel].filter(Boolean).join(' · ')}
                        >
                          {reference}
                        </span>
                      )}
                    </td>
                    <td className="min-w-0 max-w-0 px-5 py-3 text-sm text-text-secondary">
                      <span className="block truncate" title={s.customer?.name ?? undefined}>
                        {s.customer?.name ?? '—'}
                      </span>
                    </td>
                    <td className="min-w-0 max-w-0 px-5 py-3 text-sm text-text-secondary">
                      <span className="block truncate" title={s.route ?? undefined}>
                        {s.route ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant="status" value={s.status} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm text-text-muted">
                      {sailedAt ? (
                        <span title={formatRelativeTime(sailedAt)}>{formatDate(sailedAt)}</span>
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
