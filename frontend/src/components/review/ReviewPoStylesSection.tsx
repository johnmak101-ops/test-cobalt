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
import {
  REVIEW_COL,
  REVIEW_GROUP_HEADER,
  REVIEW_TABLE_CLASS,
  REVIEW_TD,
  REVIEW_TH,
} from './review-table-layout'
import { cn } from '../../lib/utils'

/** Quiet text actions — no pill buttons on every row (keeps the strip scannable). */
const LINK_ACT =
  'text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const LINK_MUTED = 'text-text-muted hover:text-text-primary'
const LINK_PRIMARY = 'text-cobalt-primary-light hover:underline'
const LINK_DANGER = 'text-status-critical/90 hover:text-status-critical'
const LINK_SAVE =
  'rounded-md border border-cobalt-primary bg-cobalt-primary px-2 py-0.5 text-[11px] font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50'

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
  const [busyPoId, setBusyPoId] = useState<string | null>(null)

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )

  const takeProposed = (po: LinkedPO, proposed: string) => {
    setBusyPoId(po.id)
    update.mutate(
      { id: po.id, itemStyleNo: proposed },
      {
        onSuccess: () => toast(`Style updated on PO ${po.poNumber}`),
        onError: () => toast.error(`Couldn't update style on PO ${po.poNumber}`),
        onSettled: () => setBusyPoId(null),
      },
    )
  }

  const saveEdit = (po: LinkedPO) => {
    const next = editValue.trim() || null
    setBusyPoId(po.id)
    update.mutate(
      { id: po.id, itemStyleNo: next },
      {
        onSuccess: () => {
          toast(`Style updated on PO ${po.poNumber}`)
          setEditingId(null)
        },
        onError: () => toast.error(`Couldn't update style on PO ${po.poNumber}`),
        onSettled: () => setBusyPoId(null),
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

  return (
    <section
      className="max-w-full overflow-x-auto rounded-lg border border-border"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
      {/* Exactly 3 columns — same % as field conflict table so Current style lines up with Existing. */}
      <table className={REVIEW_TABLE_CLASS}>
        <thead>
          <tr className="border-b border-border bg-surface-900/30">
            <th colSpan={3} className={REVIEW_GROUP_HEADER}>
              POs & styles
              <span className="ml-2 font-normal normal-case tracking-normal">
                ({sorted.length} {sorted.length === 1 ? 'PO' : 'POs'})
              </span>
            </th>
          </tr>
          <tr className="border-b border-border bg-surface-900/50">
            <th className={cn(REVIEW_COL.label, REVIEW_TH)}>PO#</th>
            <th className={cn(REVIEW_COL.existing, REVIEW_TH)}>Current style</th>
            <th className={cn(REVIEW_COL.proposed, REVIEW_TH)}>From email / AI</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-sm text-text-muted">
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
              // Only offer Take when AI differs — Keep is implicit (do nothing).
              const showTake =
                !!proposed && proposed.trim() !== '' && proposed.trim() !== (current ?? '')

              return (
                <tr
                  key={po.id}
                  data-testid={`review-po-row-${po.id}`}
                  className="group border-b border-border last:border-0 align-top"
                >
                  <td className={cn(REVIEW_TD, 'text-xs font-medium text-text-primary')}>
                    <a
                      href={`/purchase-orders/${po.id}`}
                      className="font-mono text-xs font-medium text-cobalt-primary-light hover:underline"
                    >
                      {po.poNumber}
                    </a>
                    {/* Membership: quiet text under PO# — not a second button bar */}
                    {!readOnly && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {isBusy && (
                          <Loader2
                            size={12}
                            className="animate-spin text-text-muted"
                            aria-label="Working"
                          />
                        )}
                        <button
                          type="button"
                          className={cn(LINK_ACT, LINK_DANGER)}
                          onClick={() => removeFromShipment(po)}
                          disabled={isBusy}
                          title="Unlink this PO from the current shipment"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className={cn(LINK_ACT, LINK_MUTED)}
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
                      </div>
                    )}
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
                  </td>

                  <td className={REVIEW_TD}>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <input
                          className={inputCls}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          aria-label={`Style for PO ${po.poNumber}`}
                          autoFocus
                        />
                        {!readOnly && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className={LINK_SAVE}
                              onClick={() => saveEdit(po)}
                              disabled={isBusy}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className={cn(LINK_ACT, LINK_MUTED)}
                              onClick={() => setEditingId(null)}
                              disabled={isBusy}
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={cn(
                            'field-value font-mono text-sm',
                            current ? 'text-text-primary' : 'text-text-muted',
                          )}
                          title={current ?? undefined}
                        >
                          {current ?? '—'}
                        </span>
                        {!readOnly && (
                          <button
                            type="button"
                            className={cn(LINK_ACT, LINK_MUTED, 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
                            onClick={() => {
                              setEditingId(po.id)
                              setEditValue(current ?? '')
                              setMovingPoId(null)
                            }}
                            disabled={isBusy}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  <td className={REVIEW_TD}>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={cn(
                          'field-value font-mono text-sm',
                          proposed ? 'font-medium text-ai-proposed' : 'text-text-muted',
                        )}
                        title={proposed ?? undefined}
                      >
                        {proposed ?? '—'}
                      </span>
                      {!readOnly && !isEditing && showTake && (
                        <button
                          type="button"
                          className={cn(LINK_ACT, LINK_PRIMARY)}
                          onClick={() => takeProposed(po, proposed!)}
                          disabled={isBusy}
                          title="Apply this style to the PO"
                        >
                          Use
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </section>
  )
}
