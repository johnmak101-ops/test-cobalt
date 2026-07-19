/**
 * Review strip: one row per linked PO for membership (remove / move) and per-PO item/style.
 * Not wired into ReviewCard here — Task 4 mounts it.
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
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

/** Compact row actions — same weight as conflict table chrome, short labels so the Actions col fits. */
const ACTION_BTN =
  'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
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
  'w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

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
    setBusyPoId(po.id)
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
        onSettled: () => setBusyPoId(null),
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
    setBusyPoId(po.id)
    unlink.mutate(
      { poId: po.id, linkId: po.linkId },
      {
        onSuccess: () => toast(`Removed PO ${po.poNumber} from this shipment`),
        onError: () => toast.error(`Couldn't remove PO ${po.poNumber}`),
        onSettled: () => setBusyPoId(null),
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

  const mutationBusy =
    update.isPending || unlink.isPending || link.isPending || busyPoId != null

  // Column geometry mirrors the field conflict table (Field 22% | Existing 33% | AI Proposed 45%).
  // With actions: first two columns keep that alignment; the 45% proposed span splits into AI + Actions.
  const colPo = 'w-[22%]'
  const colCurrent = 'w-[33%]'
  const colProposed = readOnly ? 'w-[45%]' : 'w-[25%]'
  const colActions = 'w-[20%]'

  return (
    <section
      className="max-w-full overflow-x-auto rounded-lg border border-border"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
      {/* Same min-width + table-fixed shell as ReviewCard conflict table so stacked grids line up. */}
      <table className="w-full min-w-[36rem] table-fixed">
        <thead>
          <tr className="border-b border-border bg-surface-900/30">
            <th
              colSpan={readOnly ? 3 : 4}
              className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-muted"
            >
              POs & styles
              <span className="ml-2 font-normal normal-case tracking-normal">
                ({sorted.length} {sorted.length === 1 ? 'PO' : 'POs'})
              </span>
            </th>
          </tr>
          <tr className="border-b border-border bg-surface-900/50 text-left text-[11px] font-medium text-text-muted">
            <th className={cn(colPo, 'px-3 py-2')}>PO#</th>
            <th className={cn(colCurrent, 'px-3 py-2')}>Current style</th>
            <th className={cn(colProposed, 'px-3 py-2')}>From email / AI</th>
            {!readOnly && <th className={cn(colActions, 'px-3 py-2')}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={readOnly ? 3 : 4}
                className="px-3 py-6 text-center text-sm text-text-muted"
              >
                No POs on this shipment
                <span className="mt-1 block text-xs">
                  Open the full shipment to add POs, or fix membership after the next email.
                </span>
              </td>
            </tr>
          ) : (
            sorted.map((po) => {
              const proposed = proposedStyleForPo(po.poNumber, reviewReasons)
              const current = po.itemStyleNo?.trim() || null
              const isEditing = editingId === po.id
              const isMoving = movingPoId === po.id
              const isBusy =
                busyPoId === po.id ||
                (update.isPending && editingId === po.id) ||
                (mutationBusy && busyPoId === po.id)
              const styleDone = styleKeptIds.has(po.id)
              const showTake =
                !!proposed && proposed.trim() !== '' && proposed.trim() !== (current ?? '')

              return (
                <tr
                  key={po.id}
                  data-testid={`review-po-row-${po.id}`}
                  className="border-b border-border last:border-0 align-top"
                >
                  {/* Match ConflictRow field label: text-xs medium */}
                  <td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5 text-xs font-medium text-text-primary">
                    <a
                      href={`/purchase-orders/${po.id}`}
                      className="font-mono text-xs font-medium text-cobalt-primary-light hover:underline"
                    >
                      {po.poNumber}
                    </a>
                  </td>

                  {/* Match Existing value: field-value font-mono text-sm */}
                  <td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5">
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
                          'field-value font-mono text-sm',
                          current ? 'text-text-primary' : 'text-text-muted',
                          styleDone && 'text-status-success',
                        )}
                        title={current ?? undefined}
                      >
                        {current ?? '—'}
                      </span>
                    )}
                  </td>

                  <td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5">
                    <span
                      className={cn(
                        'field-value font-mono text-sm',
                        proposed ? 'font-medium text-ai-proposed' : 'text-text-muted',
                      )}
                      title={proposed ?? undefined}
                    >
                      {proposed ?? '—'}
                    </span>
                  </td>

                  {!readOnly && (
                    <td className="min-w-0 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {isBusy && (
                          <Loader2
                            size={13}
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
                            {showTake && (
                              <button
                                type="button"
                                className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                                onClick={() => takeProposed(po, proposed!)}
                                disabled={isBusy}
                              >
                                Take
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
                              title="Unlink this PO from the current shipment"
                            >
                              Remove
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
                              title="Search any shipment and move this PO there"
                            >
                              Move…
                            </button>
                          </>
                        )}
                      </div>
                      {isMoving && (
                        <div className="mt-2 min-w-0">
                          <ShipmentSearchPicker
                            excludeId={shipmentId}
                            onSelect={(id, hit) => {
                              void movePo(po, id, hit)
                            }}
                            onCancel={() => setMovingPoId(null)}
                          />
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </section>
  )
}
