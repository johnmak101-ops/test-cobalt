import { Fragment, useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '../ui/Badge'
import { formatShortDate, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ChevronRight, ChevronDown, Package } from 'lucide-react'
import type { LinkedPO, Shipment } from '../../hooks/use-shipments'

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

  const panel =
    open && coords && poCount > 0
      ? createPortal(
          <div
            role="dialog"
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
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              Customer Purchase Orders
            </p>
            <div className="divide-y divide-border">
              {linkedPOs.map((po) => (
                <div
                  key={po.id}
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    setOpen(false)
                    onSelectPo(po.id, shipmentId)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      setOpen(false)
                      onSelectPo(po.id, shipmentId)
                    }
                  }}
                  className="cursor-pointer rounded-md px-2 py-2 transition-colors hover:bg-surface-700"
                >
                  <span className="font-mono text-xs font-medium text-cobalt-primary-light">{po.poNumber}</span>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                    <span className="min-w-0 truncate">{po.vendor?.name ?? '—'}</span>
                    <span className="ml-2 shrink-0">
                      {po.quantity ?? '—'} {po.totalQuantity ? `/ ${po.totalQuantity}` : ''}{' '}
                      {po.quantityUnit ?? ''}
                    </span>
                  </div>
                </div>
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

export function ShipmentTable({ shipments }: ShipmentTableProps) {
  const navigate = useNavigate()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggleExpanded = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-900/50">
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Booking No</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">SO No</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer PO#</th>
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
            {shipments.map((s) => {
              const isExpanded = expandedIds.has(s.id)
              const poCount = s.linkedPOs?.length ?? 0

              return (
                <Fragment key={s.id}>
                  {/* Shipment parent row */}
                  <tr
                    onClick={() => navigate(`/shipments/${s.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700 transition-colors"
                  >
                    <td className="px-2 py-3 text-center">
                      {poCount > 0 ? (
                        <button
                          onClick={(e) => toggleExpanded(s.id, e)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-surface-600 hover:text-text-primary transition-colors"
                        >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-medium text-cobalt-primary-light">
                      {s.bookingNo ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-text-secondary">
                      {s.soNumber ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <CustomerPoChip
                        linkedPOs={s.linkedPOs ?? []}
                        shipmentId={s.id}
                        onSelectPo={(poId, fromShipment) =>
                          navigate(`/purchase-orders/${poId}`, { state: { fromShipment } })
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {s.customer?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {s.forwarder?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant="status" value={s.status} />
                        {s.reviewStatus === 'provisional' && (
                          <span title="Awaiting review" className="inline-flex shrink-0">
                            <AlertTriangle size={13} className="text-status-warning" />
                          </span>
                        )}
                      </span>
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

                  {/* Expanded PO child rows */}
                  {isExpanded && s.linkedPOs?.map((po) => (
                    <tr
                      key={`${s.id}-${po.id}`}
                      onClick={() => navigate(`/shipments/${s.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 bg-surface-900/40 hover:bg-surface-700/50 transition-colors"
                    >
                      <td className="px-2 py-2"></td>
                      <td className="px-4 py-2 pl-8">
                        <span className="text-[11px] text-text-muted">└</span>
                      </td>
                      <td className="px-4 py-2"></td>
                      <td className="px-4 py-2 font-mono text-xs text-cobalt-primary-light/80">
                        {po.poNumber}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-muted">
                        {po.vendor?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-muted" colSpan={2}>
                        {po.quantity ?? '—'} / {po.totalQuantity ?? '—'} {po.quantityUnit ?? ''}
                      </td>
                      <td className="px-4 py-2" colSpan={5}></td>
                    </tr>
                  ))}
                </Fragment>
              )
            })}
            {shipments.length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-12 text-center text-sm text-text-muted">
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
