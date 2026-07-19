import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Clock, ArrowRight } from 'lucide-react'
import { formatDateTime } from '../../lib/utils'
import type { HistoryEntry } from '../../hooks/use-shipment-history'
import { formatFieldValue, sourceLabels } from './ShipmentHistoryTimeline'

/**
 * Order Details reads a field's change history from here (indexed by canonical leg column) instead
 * of threading it through ~30 DetailRows. Provided around the read-only Order Details grid.
 */
export const FieldHistoryContext = createContext<Map<string, HistoryEntry[]>>(new Map())

/**
 * Wrap a field VALUE so a changed field shows a dotted underline + clock marker, and hovering opens a
 * portaled popover with just that field's change timeline. Portaled to body (like the PO chip, #118)
 * so the surrounding card's overflow can't clip it. Renders `children` unchanged when `entries` is
 * empty — the caller decides which fields have history.
 */
export function FieldHistoryPopover({
  label,
  entries,
  children,
}: {
  label: string
  entries: HistoryEntry[]
  children: ReactNode
}) {
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
    setCoords({ top: placeAbove ? r.top - 4 : r.bottom + 4, left, maxHeight, placeAbove })
  }, [])

  const openPopover = () => {
    if (entries.length === 0) return
    clearClose()
    place()
    setOpen(true)
  }

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

  if (entries.length === 0) return <>{children}</>

  const panel =
    open && coords
      ? createPortal(
          <div
            role="region"
            aria-label={`${label} change history`}
            data-testid="field-history-popover"
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
            <p className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <Clock size={11} className="shrink-0" />
              <span className="min-w-0 truncate">{label} — change history</span>
            </p>
            <div className="divide-y divide-border font-sans">
              {entries.map((e) => (
                <div key={e.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="min-w-0 break-words text-text-muted line-through">
                      {formatFieldValue(e.field, e.oldValue)}
                    </span>
                    <ArrowRight size={10} className="shrink-0 text-text-muted" />
                    <span className="min-w-0 break-words font-medium text-text-secondary">
                      {formatFieldValue(e.field, e.newValue)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-muted">
                    {sourceLabels[e.sourceType] ?? e.sourceType} · {formatDateTime(e.changedAt)}
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
        data-testid="field-history-anchor"
        className="cursor-help"
        onMouseEnter={openPopover}
        onMouseLeave={scheduleClose}
      >
        <span className="underline decoration-dashed decoration-1 decoration-text-muted/60 underline-offset-4">
          {children}
        </span>
        <Clock
          size={11}
          aria-hidden="true"
          className="ml-1 inline-block shrink-0 align-baseline text-cobalt-primary-light/70"
        />
      </span>
      {panel}
    </>
  )
}
