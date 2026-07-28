import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '../ui/Badge'
import { formatShipmentId, formatShortDate, formatRelativeTime, cn } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Package } from 'lucide-react'

/**
 * A route, breakable only at the arrow.
 *
 * "CNYTN→NLRTM" is one token to the browser, so a column too narrow for it broke it wherever it
 * happened to run out — "CNYTN→NL / RTM". A port code split across two lines is not a shortened
 * label, it is a different string the operator has to reassemble before they can read it.
 *
 * `<wbr>` gives the ONLY legal break point, after the arrow, so the worst case is
 * "CNYTN→ / NLRTM" — both codes still intact.
 */
function routeParts(route: string | null | undefined) {
  const r = (route ?? '').trim()
  if (r === '') return '—'
  const i = r.indexOf('→')
  if (i < 0) return r
  return (
    <>
      {r.slice(0, i + 1)}
      <wbr />
      {r.slice(i + 1)}
    </>
  )
}
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
        /* nowrap: "0 POs" / "2 POs" wrapped onto two lines in the narrow PO column, inflating the
           chip into a tall oval beside the single-line "1 PO" chips on every other row. */
        className="inline-flex cursor-default items-center gap-1.5 whitespace-nowrap rounded-md bg-surface-600 px-2 py-0.5 text-xs font-medium text-text-secondary"
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
        {/* lg shows all ten columns; 1000px could not seat them, so every column was squeezed
            below its content and the cells broke tokens to cope ("CNYTN→NL / RTM"). 1240px is the
            sum of what the columns actually need — narrower viewports scroll, with Shipment ID
            pinned, which is what the sticky column and this scroll container are for. */}
        <table className="w-full table-fixed md:min-w-[600px] lg:min-w-[1240px]">
          <thead>
            <tr className="border-b border-border bg-surface-850">
              {/* Shipment ID is pinned: once the table scrolls sideways, row identity must stay put.
                  Opaque bg (not a /50 tint) so scrolled cells cannot show through, and the right-hand
                  divider is an inset shadow — a border-r does not travel with a sticky cell once
                  Tailwind's preflight collapses table borders. */}
              <th className={cn('sticky left-0 z-[1] w-[12%] bg-surface-850 px-3 py-3 text-left text-xs font-medium text-text-muted', scrolled && PINNED_DIVIDER)}>Shipment ID</th>
              <th className="hidden w-[9%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">Customer PO#</th>
              {/* Codes need 6%, but these cells WRAP rather than truncate, so the width that matters
                  is the one the exception needs: at 6% an unresolved "STRAUSS OPERATIONS Gmbh & Co.
                  KG" wrapped to five lines and made a 169px row. 9% lands it in three. */}
              <th className="hidden w-[9%] px-3 py-3 text-left text-xs font-medium text-text-muted lg:table-cell">Customer</th>
              {/* Sized for the longest real agent name to wrap in two lines, not five. */}
              <th className="hidden w-[15%] px-3 py-3 text-left text-xs font-medium text-text-muted md:table-cell">Forwarder</th>
              <th className="w-[12%] px-3 py-3 text-left text-xs font-medium text-text-muted">Route</th>
              {/* 13%, not 11%: the Badge truncates itself to fit its cell, so the longest status
                  ("Booking Request") rendered as "Booking Reque" — a clipped word reads as a broken
                  chip, not as a shortened one. Route gives up the 2%; it truncates a route legibly
                  ("CNYTN→NL…"), a status label does not. */}
              <th className="w-[13%] px-3 py-3 text-left text-xs font-medium text-text-muted">Status</th>
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
                /* Fixed height, two lines' worth.
                   Wrapping alone gave every row its own height (50-169px) and the table lost its
                   rhythm — scanning a column of ETDs meant re-finding the line each time. Two lines
                   is where the trade sits: it holds every value the table actually carries except one
                   46-character agent name, and the cells clamp rather than push the row taller. */
                className="group h-[68px] cursor-pointer border-b border-border last:border-0 hover:bg-surface-700 transition-colors"
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
                {/* The CODE, not the name.
                    "WYSE LONDON LI…" spent 12% of the table to say less than "WYSE" does: four rows
                    of it were indistinguishable, and the part that would have told them apart is the
                    part that got cut. Codes are what operators quote, they are 4-6 chars, and they
                    never truncate. The full legal name is one hover away. */}
                {/* WRAPS, never truncates.
                    A code fits on one line, so the common row is unchanged; it is the exception —
                    a leg whose customer never resolved and falls back to a raw name — that used to
                    read "STRA…". In a table whose whole job is telling rows apart, a second line
                    costs less than a cut word. `break-words` only breaks when a token genuinely
                    cannot fit, so "STRAUSS OPERATIONS Gmbh & Co. KG" wraps at its spaces. */}
                <td
                  className="hidden px-3 py-3 align-middle text-sm lg:table-cell"
                  title={s.customer?.name ?? s.customerRaw ?? undefined}
                >
                  <span
                    className="line-clamp-2 font-mono text-text-secondary"
                    data-testid="customer-code"
                  >
                    {s.customer?.code ?? s.customerRaw ?? s.customer?.name ?? '—'}
                  </span>
                </td>
                {/* "Logimark International Limited Guangzhou Branch" is 46 characters — no column
                    width reaches it, and every Logimark row read "Logimark Internation…", which is
                    nine rows rendered indistinguishable. Two lines tells them apart. */}
                <td
                  className="hidden px-3 py-3 align-middle text-sm text-text-secondary md:table-cell"
                  title={s.forwarder?.name ?? s.forwarderRaw ?? undefined}
                >
                  <span className="line-clamp-2">{s.forwarder?.name ?? s.forwarderRaw ?? '—'}</span>
                </td>
                {/* Routes are short once both ports resolve; the long ones are exactly the rows worth
                    seeing — an unresolved POL showing as a city name ("HONG KONG→GBFXT"). */}
                <td className="px-3 py-3 align-middle text-sm text-text-secondary" title={s.route ?? undefined}>
                  <span className="line-clamp-2">{routeParts(s.route)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-3">
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
