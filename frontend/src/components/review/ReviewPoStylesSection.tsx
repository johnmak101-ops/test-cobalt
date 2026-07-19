/**
 * Review strip: one row per linked PO. View PO# + style; Edit mode edits both simply.
 * Membership (remove/move) and one-click "Use AI" were removed for a quieter operator surface.
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { LinkedPO } from '../../hooks/use-shipments'
import { useUpdatePurchaseOrder } from '../../hooks/use-purchase-orders'
import { toast } from '../ui/Toast'
import {
  REVIEW_COL,
  REVIEW_GROUP_HEADER,
  REVIEW_TABLE_CLASS,
  REVIEW_TD,
  REVIEW_TH,
} from './review-table-layout'
import { cn } from '../../lib/utils'

const LINK_ACT =
  'text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const LINK_MUTED = 'text-text-muted hover:text-text-primary'
const BTN_SAVE =
  'rounded-md border border-cobalt-primary bg-cobalt-primary px-2 py-0.5 text-[11px] font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50'

const inputCls =
  'w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Proposed style from review reasons: `PO {n}: item/style … (kept Z)`.
 * Display-only reference — operators edit PO# / style via Edit, not one-click Apply.
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
  reviewReasons?: string[]
}

export function ReviewPoStylesSection({
  linkedPOs,
  readOnly = false,
  reviewReasons = [],
}: ReviewPoStylesSectionProps) {
  const update = useUpdatePurchaseOrder()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPo, setEditPo] = useState('')
  const [editStyle, setEditStyle] = useState('')
  const [busyPoId, setBusyPoId] = useState<string | null>(null)

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )

  const startEdit = (po: LinkedPO) => {
    setEditingId(po.id)
    setEditPo(po.poNumber)
    setEditStyle(po.itemStyleNo?.trim() ?? '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPo('')
    setEditStyle('')
  }

  const saveEdit = (po: LinkedPO) => {
    const poNumber = editPo.trim()
    if (!poNumber) {
      toast.error('PO# is required')
      return
    }
    const itemStyleNo = editStyle.trim() || null
    const fields: { id: string; poNumber?: string; itemStyleNo?: string | null } = { id: po.id }
    if (poNumber !== po.poNumber) fields.poNumber = poNumber
    if ((itemStyleNo ?? '') !== (po.itemStyleNo?.trim() ?? '')) fields.itemStyleNo = itemStyleNo
    if (fields.poNumber == null && !('itemStyleNo' in fields)) {
      cancelEdit()
      return
    }
    setBusyPoId(po.id)
    update.mutate(fields, {
      onSuccess: () => {
        toast(`Saved PO ${poNumber}`)
        cancelEdit()
      },
      onError: () => toast.error(`Couldn't save PO ${poNumber}`),
      onSettled: () => setBusyPoId(null),
    })
  }

  return (
    <section
      className="max-w-full overflow-x-auto rounded-lg border border-border"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
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
              </td>
            </tr>
          ) : (
            sorted.map((po) => {
              const proposed = proposedStyleForPo(po.poNumber, reviewReasons)
              const current = po.itemStyleNo?.trim() || null
              const isEditing = editingId === po.id
              const isBusy = busyPoId === po.id || (update.isPending && editingId === po.id)

              return (
                <tr
                  key={po.id}
                  data-testid={`review-po-row-${po.id}`}
                  className="group border-b border-border last:border-0 align-top"
                >
                  <td className={cn(REVIEW_TD, 'text-xs font-medium text-text-primary')}>
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <input
                          className={inputCls}
                          value={editPo}
                          onChange={(e) => setEditPo(e.target.value)}
                          aria-label={`PO number for ${po.poNumber}`}
                          autoFocus
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className={BTN_SAVE}
                            onClick={() => saveEdit(po)}
                            disabled={isBusy}
                          >
                            {isBusy ? (
                              <Loader2 size={12} className="inline animate-spin" aria-hidden />
                            ) : (
                              'Save'
                            )}
                          </button>
                          <button
                            type="button"
                            className={cn(LINK_ACT, LINK_MUTED)}
                            onClick={cancelEdit}
                            disabled={isBusy}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <a
                          href={`/purchase-orders/${po.id}`}
                          className="font-mono text-xs font-medium text-cobalt-primary-light hover:underline"
                        >
                          {po.poNumber}
                        </a>
                        {!readOnly && (
                          <button
                            type="button"
                            className={cn(
                              LINK_ACT,
                              LINK_MUTED,
                              'opacity-0 group-hover:opacity-100 focus:opacity-100',
                            )}
                            onClick={() => startEdit(po)}
                            disabled={isBusy || editingId != null}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </td>

                  <td className={REVIEW_TD}>
                    {isEditing ? (
                      <input
                        className={inputCls}
                        value={editStyle}
                        onChange={(e) => setEditStyle(e.target.value)}
                        aria-label={`Style for PO ${po.poNumber}`}
                        placeholder="Item / style"
                      />
                    ) : (
                      <span
                        className={cn(
                          'field-value font-mono text-sm',
                          current ? 'text-text-primary' : 'text-text-muted',
                        )}
                        title={current ?? undefined}
                      >
                        {current ?? '—'}
                      </span>
                    )}
                  </td>

                  <td className={REVIEW_TD}>
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
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </section>
  )
}
