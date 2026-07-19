/**
 * Review strip: one row per linked PO.
 * Edit mode is driven by the card-level blue Edit / Done editing control (same as conflict table).
 * No per-row Edit / Remove / Move / Use — values only, or inputs while the card is editing.
 */
import { useEffect, useRef, useState } from 'react'
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

const inputCls =
  'w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Proposed style from review reasons — display-only reference. */
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

type Draft = { poNumber: string; itemStyleNo: string }

function draftsFromPos(pos: LinkedPO[]): Record<string, Draft> {
  const out: Record<string, Draft> = {}
  for (const p of pos) {
    out[p.id] = {
      poNumber: p.poNumber,
      itemStyleNo: p.itemStyleNo?.trim() ?? '',
    }
  }
  return out
}

export interface ReviewPoStylesSectionProps {
  shipmentId: string
  linkedPOs: LinkedPO[]
  readOnly?: boolean
  /** Card-level Edit / Done editing — same flag as ConflictRow. */
  editing?: boolean
  reviewReasons?: string[]
}

export function ReviewPoStylesSection({
  linkedPOs,
  readOnly = false,
  editing = false,
  reviewReasons = [],
}: ReviewPoStylesSectionProps) {
  const update = useUpdatePurchaseOrder()
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsFromPos(linkedPOs))
  const prevEditing = useRef(false)
  const draftsRef = useRef(drafts)
  const linkedRef = useRef(linkedPOs)
  draftsRef.current = drafts
  linkedRef.current = linkedPOs

  const canEdit = editing && !readOnly

  // Keep drafts in sync when not editing (server refresh after save / navigation).
  useEffect(() => {
    if (!canEdit) setDrafts(draftsFromPos(linkedPOs))
  }, [linkedPOs, canEdit])

  // Enter edit → seed. Leave edit (Done editing) → persist dirty rows.
  useEffect(() => {
    const was = prevEditing.current
    prevEditing.current = canEdit

    if (canEdit && !was) {
      setDrafts(draftsFromPos(linkedRef.current))
      return
    }

    if (!canEdit && was) {
      const d = draftsRef.current
      const pos = linkedRef.current
      const saves: Promise<unknown>[] = []
      for (const po of pos) {
        const draft = d[po.id]
        if (!draft) continue
        const poNumber = draft.poNumber.trim()
        if (!poNumber) {
          toast.error(`PO# required (${po.poNumber})`)
          continue
        }
        const itemStyleNo = draft.itemStyleNo.trim() || null
        const patch: { id: string; poNumber?: string; itemStyleNo?: string | null } = {
          id: po.id,
        }
        if (poNumber !== po.poNumber) patch.poNumber = poNumber
        if ((itemStyleNo ?? '') !== (po.itemStyleNo?.trim() ?? '')) {
          patch.itemStyleNo = itemStyleNo
        }
        if (patch.poNumber == null && !('itemStyleNo' in patch)) continue
        saves.push(
          update.mutateAsync(patch).catch(() => {
            toast.error(`Couldn't save PO ${poNumber}`)
          }),
        )
      }
      if (saves.length > 0) {
        void Promise.all(saves).then((results) => {
          const ok = results.filter((r) => r !== undefined).length
          if (ok > 0) toast(`Saved ${ok} PO${ok === 1 ? '' : 's'}`)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to canEdit edges; mutateAsync is stable enough for flush
  }, [canEdit])

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { poNumber: '', itemStyleNo: '' }), ...patch },
    }))
  }

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )

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
                {canEdit ? ' — editing' : ''}
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
              const draft = drafts[po.id] ?? {
                poNumber: po.poNumber,
                itemStyleNo: po.itemStyleNo?.trim() ?? '',
              }
              const current = po.itemStyleNo?.trim() || null

              return (
                <tr
                  key={po.id}
                  data-testid={`review-po-row-${po.id}`}
                  className="border-b border-border last:border-0 align-top"
                >
                  <td className={cn(REVIEW_TD, 'text-xs font-medium text-text-primary')}>
                    {canEdit ? (
                      <input
                        className={inputCls}
                        value={draft.poNumber}
                        onChange={(e) => setDraft(po.id, { poNumber: e.target.value })}
                        aria-label={`PO number for ${po.poNumber}`}
                      />
                    ) : (
                      <a
                        href={`/purchase-orders/${po.id}`}
                        className="font-mono text-xs font-medium text-cobalt-primary-light hover:underline"
                      >
                        {po.poNumber}
                      </a>
                    )}
                  </td>

                  <td className={REVIEW_TD}>
                    {canEdit ? (
                      <input
                        className={inputCls}
                        value={draft.itemStyleNo}
                        onChange={(e) => setDraft(po.id, { itemStyleNo: e.target.value })}
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
