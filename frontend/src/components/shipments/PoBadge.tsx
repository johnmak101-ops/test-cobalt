import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Package } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { LinkedPO } from '../../hooks/use-shipments'

const TOOLTIP_W = 288 // matches w-72

/**
 * The "N POs" badge with a hover list of the linked POs. The list is rendered in a PORTAL
 * (to document.body, position:fixed) so it can't be clipped by the table's `overflow-hidden` /
 * `overflow-x-auto` ancestors — a long list (e.g. 11 POs) used to get cropped. Height is capped to
 * the viewport with internal scroll, and a short close-delay lets the cursor cross the gap.
 */
export function PoBadge({ shipmentId, pos }: { shipmentId: string; pos: LinkedPO[] }) {
  const navigate = useNavigate()
  const ref = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [box, setBox] = useState<{ top: number; left: number; maxH: number } | null>(null)
  const count = pos.length

  const open = () => {
    clearTimeout(timer.current)
    const el = ref.current
    if (!el || count === 0) return
    const r = el.getBoundingClientRect()
    const top = r.bottom + 4
    setBox({
      top,
      left: Math.max(8, Math.min(r.left, window.innerWidth - TOOLTIP_W - 8)),
      maxH: Math.max(140, window.innerHeight - top - 12),
    })
  }
  const close = () => {
    timer.current = setTimeout(() => setBox(null), 120)
  }

  return (
    <span ref={ref} onMouseEnter={open} onMouseLeave={close} className="inline-block">
      <span className="inline-flex cursor-default items-center gap-1.5 rounded-md bg-surface-600 px-2 py-0.5 text-xs font-medium text-text-secondary">
        <Package size={12} className="text-text-muted" />
        {count} PO{count !== 1 ? 's' : ''}
      </span>
      {box &&
        count > 0 &&
        createPortal(
          <div
            onMouseEnter={open}
            onMouseLeave={close}
            style={{ position: 'fixed', top: box.top, left: box.left, width: TOOLTIP_W, maxHeight: box.maxH }}
            className="z-[100] overflow-y-auto rounded-lg border border-border bg-surface-800 p-3 shadow-xl"
          >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Purchase Orders</p>
            <div className="divide-y divide-border">
              {pos.map((po) => (
                <div
                  key={po.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/purchase-orders/${po.id}`, { state: { fromShipment: shipmentId } })
                  }}
                  className="cursor-pointer rounded-md px-2 py-2 transition-colors hover:bg-surface-700"
                >
                  <span className="font-mono text-xs font-medium text-cobalt-primary-light">{po.poNumber}</span>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-muted">
                    <span className="truncate">{po.vendor?.name ?? '—'}</span>
                    <span className="ml-3 shrink-0">
                      {po.totalQuantity != null ? `${po.totalQuantity} ${po.quantityUnit ?? ''}` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}
