/**
 * Review strip: one row per linked PO for membership (remove / move) and per-PO item/style.
 * Not wired into ReviewCard here — Task 4 mounts it.
 */
import { useState } from 'react'
import { Loader2, Package } from 'lucide-react'
import type { LinkedPO } from '../../hooks/use-shipments'
import {
  useUpdatePurchaseOrder,
  useUnlinkShipmentFromPO,
  useLinkShipmentToPO,
} from '../../hooks/use-purchase-orders'
import { toast } from '../ui/Toast'
import { ShipmentSearchPicker } from './ShipmentSearchPicker'
import type { ShipmentSearchHit } from '../../hooks/use-shipment-search'
import { cn } from '../../lib/utils'

const ACTION_BTN =
  'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_VARIANT = {
  primary:
    'border-cobalt-primary bg-cobalt-primary text-white hover:border-cobalt-primary-light hover:bg-cobalt-primary-light',
  secondary:
    'border-cobalt-primary/30 bg-cobalt-primary/15 text-cobalt-primary-light hover:bg-cobalt-primary/25',
  danger:
    'border-status-critical/30 bg-status-critical/15 text-status-critical hover:bg-status-critical/25',
  muted:
    'border-border bg-surface-800 text-text-secondary hover:bg-surface-700 hover:text-text-primary',
} as const

const inputCls =
  'w-full min-w-[8rem] rounded-md border border-border bg-surface-700 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * v1 proposed style: parse Needs attention / reviewReasons for
 * `PO {poNumber}: item/style … (kept Z)`.
 */
export function proposedStyleForPo(
  poNumber: string,
  reviewReasons: string[],
): string | null {
  const re = new RegExp(
    `PO\\s+${escapeRegExp(poNumber)}:.*?item\\/style[\\s\\S]*?\\(kept\\s+([^)]+)\\)`,
    'i',
  )
  for (const r of reviewReasons) {
    const m = r.match(re)
    if (m?.[1]) return m[1].trim().replace(/^"|"$/g, '')
  }
  return null
}

export interface ReviewPoStylesSectionProps {
  shipmentId: string
  linkedPOs: LinkedPO[]
  readOnly?: boolean
  /** Machine / humanized review reasons — used for proposed style hints. */
  reviewReasons?: string[]
}

export function ReviewPoStylesSection({
  shipmentId,
  linkedPOs,
  readOnly = false,
  reviewReasons = [],
}: ReviewPoStylesSectionProps) {
  const update = useUpdatePurchaseOrder()
  const unlink = useUnlinkShipmentFromPO()
  const link = useLinkShipmentToPO()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [movingPoId, setMovingPoId] = useState<string | null>(null)
  const [styleKeptIds, setStyleKeptIds] = useState<Set<string>>(() => new Set())
  const [busyPoId, setBusyPoId] = useState<string | null>(null)

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )

  const takeProposed = (po: LinkedPO, proposed: string) => {
    update.mutate(
      { id: po.id, itemStyleNo: proposed },
      {
        onSuccess: () => {
          toast(`Style updated on PO ${po.poNumber}`)
          setStyleKeptIds((s) => {
            const next = new Set(s)
            next.add(po.id)
            return next
          })
        },
        onError: () => toast.error(`Couldn't update style on PO ${po.poNumber}`),
      },
    )
  }

  const saveEdit = (po: LinkedPO) => {
    const next = editValue.trim() || null
    update.mutate(
      { id: po.id, itemStyleNo: next },
      {
        onSuccess: () => {
          toast(`Style updated on PO ${po.poNumber}`)
          setEditingId(null)
          setStyleKeptIds((s) => {
            const n = new Set(s)
            n.add(po.id)
            return n
          })
        },
        onError: () => toast.error(`Couldn't update style on PO ${po.poNumber}`),
      },
    )
  }

  const removeFromShipment = (po: LinkedPO) => {
    if (!po.linkId) {
      toast('Open full shipment to manage this PO link')
      return
    }
    unlink.mutate(
      { poId: po.id, linkId: po.linkId },
      {
        onSuccess: () => toast(`Removed PO ${po.poNumber} from this shipment`),
        onError: () => toast.error(`Couldn't remove PO ${po.poNumber}`),
      },
    )
  }

  async function movePo(po: LinkedPO, targetId: string, hit?: ShipmentSearchHit) {
    if (!po.linkId) {
      toast('Open full shipment to manage this PO link')
      return
    }
    setBusyPoId(po.id)
    try {
      await unlink.mutateAsync({ poId: po.id, linkId: po.linkId })
      try {
        await link.mutateAsync({ poId: po.id, shipmentId: targetId })
        const dest = hit?.bookingNo?.trim() || targetId
        toast(`PO ${po.poNumber} moved to ${dest}`)
        setMovingPoId(null)
      } catch {
        toast(
          `PO ${po.poNumber} removed here but failed to link target — re-link from PO page`,
        )
        setMovingPoId(null)
      }
    } catch {
      toast.error(`Couldn't move PO ${po.poNumber} — remove failed`)
    } finally {
      setBusyPoId(null)
    }
  }

  return (
    <section
      className="rounded-lg border border-border bg-surface-900 px-3 py-3"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
      <div className="mb-2 flex items-start gap-2">
        <Package size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
        <div>
          <h4 className="text-sm font-semibold text-text-primary">POs & styles</h4>
          <p className="text-xs text-text-muted">
            Confirm each PO is on this shipment, then fix item/style per PO.
          </p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">
          No POs on this shipment
          <span className="mt-1 block text-xs">
            Open the full shipment to add POs, or fix membership after the next email.
          </span>
        </p>
      ) : (
        <div className="space-y-2">
          {/* Column headers — desktop */}
          <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto] gap-2 border-b border-border px-1 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-text-muted sm:grid">
            <span>PO#</span>
            <span>Current style</span>
            <span>From email / AI</span>
            <span className="text-right">Actions</span>
          </div>

          {sorted.map((po) => {
            const proposed = proposedStyleForPo(po.poNumber, reviewReasons)
            const current = po.itemStyleNo?.trim() || null
            const isEditing = editingId === po.id
            const isMoving = movingPoId === po.id
            const isBusy = busyPoId === po.id || (update.isPending && editingId === po.id)
            const styleDone = styleKeptIds.has(po.id)

            return (
              <div
                key={po.id}
                data-testid={`review-po-row-${po.id}`}
                className="rounded-md border border-border/60 bg-surface-800/40 px-2 py-2 sm:border-0 sm:bg-transparent sm:px-1 sm:py-1.5"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto] sm:items-start sm:gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] font-medium uppercase text-text-muted sm:hidden">
                      PO#
                    </span>
                    <a
                      href={`/purchase-orders/${po.id}`}
                      className="font-mono text-sm font-medium text-cobalt-primary-light hover:underline"
                    >
                      {po.poNumber}
                    </a>
                    <p className="text-[11px] text-text-muted">On this shipment: Yes</p>
                  </div>

                  <div className="min-w-0">
                    <span className="text-[10px] font-medium uppercase text-text-muted sm:hidden">
                      Current style
                    </span>
                    {isEditing ? (
                      <input
                        className={inputCls}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        aria-label={`Style for PO ${po.poNumber}`}
                        autoFocus
                      />
                    ) : (
                      <span
                        className={cn(
                          'block truncate font-mono text-sm',
                          current ? 'text-text-primary' : 'text-text-muted',
                          styleDone && 'text-status-success',
                        )}
                      >
                        {current ?? '—'}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <span className="text-[10px] font-medium uppercase text-text-muted sm:hidden">
                      From email / AI
                    </span>
                    <span
                      className={cn(
                        'block truncate font-mono text-sm',
                        proposed ? 'text-text-secondary' : 'text-text-muted',
                      )}
                    >
                      {proposed ?? '—'}
                    </span>
                  </div>

                  {!readOnly && (
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {isBusy && (
                        <Loader2
                          size={14}
                          className="animate-spin text-text-muted"
                          aria-label="Working"
                        />
                      )}
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className={cn(ACTION_BTN, ACTION_VARIANT.primary)}
                            onClick={() => saveEdit(po)}
                            disabled={isBusy}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className={cn(ACTION_BTN, ACTION_VARIANT.muted)}
                            onClick={() => setEditingId(null)}
                            disabled={isBusy}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={cn(ACTION_BTN, ACTION_VARIANT.muted)}
                            onClick={() => {
                              setStyleKeptIds((s) => {
                                const n = new Set(s)
                                n.add(po.id)
                                return n
                              })
                            }}
                            disabled={isBusy}
                            title="Keep current style (no write)"
                          >
                            Keep
                          </button>
                          {proposed && (
                            <button
                              type="button"
                              className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                              onClick={() => takeProposed(po, proposed)}
                              disabled={isBusy}
                            >
                              Take proposed
                            </button>
                          )}
                          <button
                            type="button"
                            className={cn(ACTION_BTN, ACTION_VARIANT.muted)}
                            onClick={() => {
                              setEditingId(po.id)
                              setEditValue(current ?? '')
                              setMovingPoId(null)
                            }}
                            disabled={isBusy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={cn(ACTION_BTN, ACTION_VARIANT.danger)}
                            onClick={() => removeFromShipment(po)}
                            disabled={isBusy}
                          >
                            Remove from this shipment
                          </button>
                          <button
                            type="button"
                            className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                            onClick={() => {
                              if (!po.linkId) {
                                toast('Open full shipment to manage this PO link')
                                return
                              }
                              setMovingPoId((id) => (id === po.id ? null : po.id))
                              setEditingId(null)
                            }}
                            disabled={isBusy}
                          >
                            Move to another shipment…
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {!readOnly && isMoving && (
                  <div className="mt-2">
                    <ShipmentSearchPicker
                      excludeId={shipmentId}
                      onSelect={(id, hit) => {
                        void movePo(po, id, hit)
                      }}
                      onCancel={() => setMovingPoId(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
