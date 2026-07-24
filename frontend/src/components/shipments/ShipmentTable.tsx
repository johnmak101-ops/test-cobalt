import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '../ui/Badge'
import { formatShipmentId, formatShortDate, formatRelativeTime, cn } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Package } from 'lucide-react'
import type { LinkedPO, Shipment } from '../../hooks/use-shipments'
import { interactiveProps } from '../../lib/interactive'

interface ShipmentTableProps {
  shipments: Shipment[]
}

/** PO chip + hover panel portaled to body so table overflow does not clip it (#118). */
function CustomerPoChip({
  linkedPOs,
  shipmentId,
  onSelectPo,
}: {
  linkedPOs: LinkedPO[]
  shipmentId: string
  onSelectPo: (poId: string, shipmentId: string) => void
}) {
  const poCount = linkedPOs.length
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{
    top: number
    left: number
    maxHeight: number
    placeAbove: boolean
  } | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    clearClose()
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  const place = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = 288 // w-72
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const spaceBelow = window.innerHeight - r.bottom - 8
    const spaceAbove = r.top - 8
    const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow
    const maxHeight = Math.max(120, placeAbove ? spaceAbove : spaceBelow)
    setCoords({
      top: placeAbove ? r.top - 4 : r.bottom + 4,
      left,
      maxHeight,
      placeAbove,
    })
  }, [])

  const openPopover = () => {
    if (poCount === 0) return
    clearClose()
    place()
    setOpen(true)
  }

  // Close on scroll/resize so the panel never sits stranded after the table moves.
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  useEffect(() => () => clearClose(), [])

  // Show POs in a stable ascending order; numeric-aware so 4483262 < 4493323 and G13… sort sensibly.
  const sortedPOs = useMemo(
    () => [...linkedPOs].sort((a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true })),
    [linkedPOs],
  )

  const panel =
    open && coords && poCount > 0
      ? createPortal(
          <div
            role="region"
            aria-label="Customer Purchase Orders"
            data-testid="customer-po-popover"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              maxHeight: coords.maxHeight,
              transform: coords.placeAbove ? 'translateY(-100%)' : undefined,
              zIndex: 9999,
            }}
            className="w-72 overflow-y-auto rounded-lg border border-border bg-surface-800 p-3 shadow-xl"
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
          >
            <p className="mb-2 text-[11px] font-semibold text-text-muted">
              Customer Purchase Orders
            </p>
            <div className="divide-y divide-border">
              {sortedPOs.map((po) => (
                <a
                  key={po.id}
                  href={`/purchase-orders/${po.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setOpen(false)
                    onSelectPo(po.id, shipmentId)
                  }}
                  className="block cursor-pointer rounded-md px-2 py-2 transition-colors hover:bg-surface-700"
                >
                  <span className="font-mono text-xs font-medium text-cobalt-primary-light">{po.poNumber}</span>
                </a>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <span
        ref={anchorRef}
        data-testid="customer-po-chip"
        className="inline-flex cursor-default items-center gap-1.5 rounded-md bg-surface-600 px-2 py-0.5 text-xs font-medium text-text-secondary"
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
      >
        <Package size={12} className="text-text-muted" />
        {poCount} PO{poCount !== 1 ? 's' : ''}
      </span>
      {panel}
    </>
  )
}

/** Sticky Shipment ID divider, drawn ONLY once the table is actually scrolled sideways. */
const PINNED_DIVIDER = 'shadow-[inset_-1px_0_0_var(--color-border)]'

export function ShipmentTable({ shipments }: ShipmentTableProps) {
  const navigate = useNavigate()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)

  /**
   * The pinned column's right-hand rule marks where content slides UNDER it. With nothing to
   * scroll it is just a stray vertical line mid-table, so it only appears past scrollLeft 0.
   * Re-checked on resize too: widening the window can end the overflow without firing `scroll`.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = () => setScrolled(el.scrollLeft > 0)
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      el.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [shipments.length])

  // Columns: Shipment ID · Customer PO# · Customer · Forwarder · Route · Status · ETD · ETA · Last · Risk
  // SO No removed from tracker (#119); detail pages still show SO.
  //
  // Priority ladder — a narrow screen keeps only what identifies and locates a shipment:
  //   base  Shipment ID · Route · Status
  //   md    + Forwarder
  //   lg    + Customer PO# · Customer · ETD · ETA · Last Activity · Risk
  // Everything dropped is on the shipment detail page a tap away. Shipment ID stays pinned so a
  // sideways scroll never loses which row you are reading.
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
      <div ref={scrollRef} className="overflow-x-auto">
        {/* Widths live on the header cells, not a <colgroup>: with table-fixed the header row defines
            the columns, and responsive hiding needs width + visibility on the SAME element. */}
        {/* No min-width below md: with three columns the table fits any phone, and forcing 560px
            would invent a sideways scroll where none is needed. */}
        <table className="w-full table-fixed md:min-w-[600px] lg:min-w-[1000px]">
          <thead>
            <tr className="border-b border-border bg-surface-850">
              {/* Shipment ID is pinned: once the table scrolls sideways, row identity must stay put.
                  Opaque bg (not a /50 tint) so scrolled cells cannot show through, and the right-hand
                  divider is an inset shadow — a border-r does not travel with a sticky cell once
                  Tailwind's preflight collapses table borders. */}
              <th className={cn('sticky left-0 z-[1] w-[12%] bg-surface-850 px-3 py-3 text-left text-xs font-medium text-text-muted', scrolled && PINNED_DIVIDER)}>Shipment ID</th>
              <th className="hidden w-[9%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">Customer PO#</th>
              <th className="hidden w-[12%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">Customer</th>
              <th className="hidden w-[11%] px-3 py-3 text-left text-xs font-medium text-text-muted md:table-cell">Forwarder</th>
              <th className="w-[12%] px-3 py-3 text-left text-xs font-medium text-text-muted">Route</th>
              <th className="w-[11%] px-3 py-3 text-left text-xs font-medium text-text-muted">Status</th>
              <th className="hidden w-[8%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">ETD</th>
              <th className="hidden w-[8%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">ETA</th>
              <th className="hidden w-[10%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">Last Activity</th>
              <th className="hidden w-14 px-2 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">Risk</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((s) => (
              <tr
                key={s.id}
                {...interactiveProps(() => navigate(`/shipments/${s.id}`))}
                className="group cursor-pointer border-b border-border last:border-0 hover:bg-surface-700 transition-colors"
              >
                {/* group-hover mirrors the row's hover onto the pinned cell — without it the sticky
                    column stays dark while the rest of the row lights up. */}
                <td className={cn('sticky left-0 z-[1] truncate bg-surface-800 px-3 py-3 font-mono text-sm font-medium text-cobalt-primary-light transition-colors group-hover:bg-surface-700', scrolled && PINNED_DIVIDER)}>
                  {/* #348/#350: derived system identity — beginning-email yyyymm (creation month when
                      no dated email) + uuid head, one shape for every row (keyless shells included).
                      The booking → SO → HBL spine stays searchable and on the detail page;
                      ReviewQueue/TopBar still show it (parse-identity D1). */}
                  {formatShipmentId(s.id, s.firstEmailAt ?? s.createdAt)}
                  {(s.legCount ?? 1) > 1 && (
                    <span className="ml-1 text-[11px] font-normal text-text-muted">
                      · Leg {s.legNo ?? 1}/{s.legCount}
                    </span>
                  )}
                </td>
                <td className="hidden px-3 py-3 lg:table-cell">
                  <CustomerPoChip
                    linkedPOs={s.linkedPOs ?? []}
                    shipmentId={s.id}
                    onSelectPo={(poId, fromShipment) =>
                      navigate(`/purchase-orders/${poId}`, { state: { fromShipment } })
                    }
                  />
                </td>
                <td className="hidden truncate px-3 py-3 text-sm text-text-secondary lg:table-cell">
                  {s.customer?.name ?? s.customerRaw ?? '—'}
                </td>
                <td className="hidden truncate px-3 py-3 text-sm text-text-secondary md:table-cell">
                  {s.forwarder?.name ?? s.forwarderRaw ?? '—'}
                </td>
                <td className="truncate px-3 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                <td className="px-3 py-3">
                  <Badge variant="status" value={s.status} />
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 text-sm text-text-secondary lg:table-cell">
                  {formatShortDate(s.etd)}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 text-sm text-text-secondary lg:table-cell">
                  {formatShortDate(s.eta)}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-3 text-sm text-text-muted lg:table-cell">
                  {formatRelativeTime(s.updatedAt)}
                </td>
                <td className="hidden px-2 py-3 lg:table-cell">
                  <span className="inline-flex items-center gap-1">
                    {s.riskLevel === 'DELAYED' && (
                      <span title="Delayed" className="inline-flex shrink-0">
                        <AlertTriangle size={16} className="text-status-critical" />
                      </span>
                    )}
                    {s.riskLevel === 'AT_RISK' && (
                      <span title="At risk" className="inline-flex shrink-0">
                        <AlertTriangle size={16} className="text-status-warning" />
                      </span>
                    )}
                    {s.reviewStatus === 'provisional' && (
                      <span title="Awaiting review" data-testid="risk-awaiting-review" className="inline-flex shrink-0">
                        <AlertTriangle size={16} className="text-status-warning" />
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-sm text-text-muted">
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
