import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { formatDate, parsePONumbers } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'
import { ALL_TIME, DateRangeSelect, inRange, type DateRange } from './DateRangeSelect'
import type { Shipment } from '../../hooks/use-shipments'

/**
 * Shipments still in flight, filtered by a date range.
 *
 * ACTIVE means not finished and not cancelled — Delivered and Cancelled drop out, since a dashboard
 * is for what still needs watching. The KPI card above counts the same set.
 *
 * The range filters ETD, the operational anchor the rest of the system keys off (alert rules fire N
 * days after ETD; the milestone timeline centres on it). A shipment with NO etd is kept when the
 * range is unbounded and dropped otherwise — a date filter that silently retains undated rows is
 * how "30 days" quietly becomes "30 days plus everything we know nothing about".
 */
const FINISHED = new Set(['ARRIVED', 'DELIVERED', 'CANCELLED'])

export function ActiveShipmentsTable({ shipments }: { shipments: Shipment[] }) {
  const navigate = useNavigate()
  /**
   * Defaults to ALL, not a 30-day window. The Active Shipments KPI card sits directly above this
   * table and counts the same set unfiltered — a default range made the card say 1 and the table
   * say 0 on the same screen. Two numbers disagreeing is worse than a long list; narrowing is one
   * click away, and the count in the heading always describes what is actually shown.
   */
  const [range, setRange] = useState<DateRange>(ALL_TIME)

  const rows = useMemo(() => {
    return shipments
      .filter((s) => !FINISHED.has(s.status))
      .filter((s) => inRange(s.etd, range))
      .sort((a, b) => (b.etd ?? '') < (a.etd ?? '') ? 1 : -1)
  }, [shipments, range])

  return (
    <div className="max-w-full overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-text-primary">
          Active Shipments
          <span className="ml-2 text-xs font-normal text-text-muted">· {rows.length}</span>
        </h3>
        <DateRangeSelect value={range} onChange={setRange} label="ETD" />
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-text-muted">
          No active shipments with an ETD in this range.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] table-fixed">
            <thead>
              <tr className="border-b border-border bg-surface-900/50">
                <th className="w-[20%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Booking / PO#</th>
                <th className="w-[20%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Customer</th>
                <th className="w-[14%] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Route</th>
                <th className="w-[8.5rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
                <th className="w-[7rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">ETD</th>
                <th className="w-[7rem] px-5 py-2.5 text-left text-xs font-medium text-text-muted">ETA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const pos = parsePONumbers(s.poNumbers)
                const poLabel =
                  pos.length > 0 ? pos.slice(0, 3).join(', ') + (pos.length > 3 ? ` +${pos.length - 3}` : '') : null
                const primary = s.bookingNo?.trim() || s.soNumber?.trim() || poLabel || '—'
                return (
                  <tr
                    key={s.id}
                    {...interactiveProps(() => navigate(`/shipments/${s.id}`))}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700"
                  >
                    <td className="min-w-0 max-w-0 px-5 py-3">
                      <span className="block truncate font-mono text-sm text-text-primary" title={primary}>
                        {primary}
                      </span>
                      {s.bookingNo && poLabel && (
                        <span className="mt-0.5 block truncate text-[11px] text-text-muted" title={poLabel}>
                          {poLabel}
                        </span>
                      )}
                    </td>
                    <td className="min-w-0 max-w-0 px-5 py-3 text-sm text-text-secondary">
                      <span className="block truncate" title={s.customer?.name ?? s.customerRaw ?? undefined}>
                        {s.customer?.name ?? s.customerRaw ?? '—'}
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
                      {s.etd ? formatDate(s.etd) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-sm text-text-muted">
                      {s.eta ? formatDate(s.eta) : '—'}
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
