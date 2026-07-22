/**
 * Review POs & styles.
 * Edit mode is the same card-level blue Edit / Done editing as the conflict table —
 * one click edits fields and every PO row together (no second Edit on this strip).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Link2Off, Loader2, Plus, X } from 'lucide-react'
import type { LinkedPO } from '../../hooks/use-shipments'
import {
  useCreatePurchaseOrder,
  useUpdatePurchaseOrder,
  useUnlinkShipmentFromPO,
  useLinkShipmentToPO,
} from '../../hooks/use-purchase-orders'
import { toast } from '../ui/Toast'
import {
  REVIEW_COL,
  REVIEW_GROUP_HEADER,
  REVIEW_HEAD,
  REVIEW_TABLE_CLASS,
  REVIEW_TD,
  REVIEW_TH,
} from './review-table-layout'
import { ReviewColGroup } from './ReviewColGroup'
import { StyleListDisplay, StyleListEditor } from './ConflictRow'
import { cn } from '../../lib/utils'

const inputCls =
  'w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

const HEADER_BTN =
  'inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-700 hover:text-text-primary disabled:opacity-50'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

interface RowForm {
  poNumber: string
  itemStyleNo: string
}

export interface ReviewPoStylesSectionProps {
  shipmentId: string
  linkedPOs: LinkedPO[]
  customerId?: string | null
  readOnly?: boolean
  /** Card-level Edit / Done editing — drives this whole strip. */
  editing?: boolean
  reviewReasons?: string[]
  /**
   * When true, no outer border/title chrome — lives inside the shared decision grid shell
   * (same column tracks as field conflicts).
   */
  embedded?: boolean
  /** When false, omit column header row (parent already rendered a shared thead). Default true. */
  showColumnHeader?: boolean
  /** Third-column header when this section owns the thead (solo PO grid). */
  proposedColumnLabel?: string
}

export function ReviewPoStylesSection({
  shipmentId,
  linkedPOs,
  customerId = null,
  readOnly = false,
  editing = false,
  reviewReasons = [],
  embedded = false,
  showColumnHeader = true,
  proposedColumnLabel = REVIEW_HEAD.proposed,
}: ReviewPoStylesSectionProps) {
  const create = useCreatePurchaseOrder()
  const update = useUpdatePurchaseOrder()
  const unlink = useUnlinkShipmentFromPO()
  const link = useLinkShipmentToPO()

  const canEdit = editing && !readOnly
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsFromPos(linkedPOs))
  const [adding, setAdding] = useState(false)
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null)

  const prevEditing = useRef(false)
  const draftsRef = useRef(drafts)
  const linkedRef = useRef(linkedPOs)

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])
  useEffect(() => {
    linkedRef.current = linkedPOs
  }, [linkedPOs])

  const busy =
    create.isPending || update.isPending || unlink.isPending || link.isPending

  // View mode: stay synced with server. Edit mode: local drafts only.
  useEffect(() => {
    if (!canEdit) {
      setDrafts(draftsFromPos(linkedPOs))
      setAdding(false)
      setConfirmUnlinkId(null)
    }
  }, [linkedPOs, canEdit])

  // Enter edit → seed drafts. Leave (Done editing) → save dirty POs.
  useEffect(() => {
    const was = prevEditing.current
    prevEditing.current = canEdit

    if (canEdit && !was) {
      setDrafts(draftsFromPos(linkedRef.current))
      setAdding(false)
      setConfirmUnlinkId(null)
      return
    }

    if (!canEdit && was) {
      setAdding(false)
      setConfirmUnlinkId(null)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const setDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? { poNumber: '', itemStyleNo: '' }), ...patch },
    }))
  }

  const handleAdd = (f: RowForm) => {
    create.mutate(
      {
        poNumber: f.poNumber.trim(),
        customerId: customerId ?? undefined,
        itemStyleNo: f.itemStyleNo.trim() || null,
      },
      {
        onSuccess: (po: unknown) => {
          const poId = (po as { id?: string })?.id
          if (!poId) return toast.error('Created the PO but got no id back')
          link.mutate(
            { poId, shipmentId },
            {
              onSuccess: () => {
                toast(`Added PO ${f.poNumber.trim()}`)
                setAdding(false)
              },
              onError: () =>
                toast.error('Created the PO, but linking it to this shipment failed'),
            },
          )
        },
        onError: () =>
          toast.error(`Couldn't add PO ${f.poNumber.trim()} — it may already exist`),
      },
    )
  }

  const handleUnlink = (po: LinkedPO) => {
    if (!po.linkId) {
      setConfirmUnlinkId(null)
      return toast.error('No shipment link to remove')
    }
    unlink.mutate(
      { poId: po.id, linkId: po.linkId },
      {
        onSuccess: () => {
          toast(`Removed PO ${po.poNumber} from this shipment`)
          setConfirmUnlinkId(null)
        },
        onError: () => toast.error('Remove failed — please retry'),
      },
    )
  }

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )
  /** Always 3 columns — matches field-conflict table (actions live inside proposed cell). */
  const colSpan = 3

  const table = (
    <table className={REVIEW_TABLE_CLASS}>
      <ReviewColGroup />
      {showColumnHeader && (
        <thead>
          <tr className="border-b border-border bg-surface-900/50">
            <th className={cn(REVIEW_COL.label, REVIEW_TH)}>{REVIEW_HEAD.label}</th>
            <th className={cn(REVIEW_COL.existing, REVIEW_TH)}>{REVIEW_HEAD.existing}</th>
            <th
              className={cn(REVIEW_COL.proposed, REVIEW_TH)}
              data-testid="proposed-column-header"
            >
              {proposedColumnLabel}
            </th>
          </tr>
        </thead>
      )}
      <tbody>
        {/* Section label row — same rhythm as conflict group headers */}
        <tr className="border-b border-border">
          <td colSpan={colSpan} className={REVIEW_GROUP_HEADER}>
            <span className="inline-flex flex-wrap items-center gap-2">
              POs & styles
              <span className="font-normal normal-case tracking-normal text-text-muted">
                ({sorted.length} {sorted.length === 1 ? 'PO' : 'POs'})
                {canEdit ? ' — editing' : ''}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(true)
                    setConfirmUnlinkId(null)
                  }}
                  disabled={busy}
                  className={HEADER_BTN}
                  data-testid="review-po-add"
                >
                  <Plus size={13} /> Add PO
                </button>
              )}
            </span>
          </td>
        </tr>
        {canEdit && adding && (
          <AddRow busy={busy} onCancel={() => setAdding(false)} onSave={handleAdd} />
        )}
        {sorted.map((po) => {
          const proposed = proposedStyleForPo(po.poNumber, reviewReasons)
          const draft = drafts[po.id] ?? {
            poNumber: po.poNumber,
            itemStyleNo: po.itemStyleNo?.trim() ?? '',
          }
          const current = po.itemStyleNo?.trim() || null

          if (canEdit && confirmUnlinkId === po.id) {
            return (
              <tr
                key={po.id}
                className="border-b border-border bg-surface-900/40"
                data-testid={`review-po-unlink-confirm-${po.id}`}
              >
                <td colSpan={colSpan} className="px-3 py-2 text-sm text-text-secondary">
                  <span className="mr-3">
                    Remove PO <span className="font-mono font-medium">{po.poNumber}</span>{' '}
                    from this shipment?
                  </span>
                  <button
                    type="button"
                    className="mr-2 font-medium text-status-critical hover:underline disabled:opacity-50"
                    disabled={busy}
                    onClick={() => handleUnlink(po)}
                  >
                    {busy ? <Loader2 size={12} className="inline animate-spin" /> : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    className="text-text-muted hover:text-text-primary"
                    disabled={busy}
                    onClick={() => setConfirmUnlinkId(null)}
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )
          }

          return (
            <tr
              key={po.id}
              data-testid={`review-po-row-${po.id}`}
              className="border-b border-border last:border-0 align-top"
            >
              <td className={cn(REVIEW_COL.label, REVIEW_TD, 'font-medium text-text-primary')}>
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
                    className="field-value font-mono text-sm font-medium leading-snug text-cobalt-primary-light hover:underline"
                  >
                    {po.poNumber}
                  </a>
                )}
              </td>
              <td className={cn(REVIEW_COL.existing, REVIEW_TD)}>
                {canEdit ? (
                  <StyleListEditor
                    label={`Style for PO ${po.poNumber}`}
                    value={draft.itemStyleNo}
                    onChange={(v) => setDraft(po.id, { itemStyleNo: v })}
                  />
                ) : (
                  <StyleListDisplay
                    value={current ?? ''}
                    className={current ? 'text-text-primary' : undefined}
                  />
                )}
              </td>
              <td className={cn(REVIEW_COL.proposed, REVIEW_TD)}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <StyleListDisplay
                      value={proposed ?? ''}
                      className={proposed ? 'font-medium text-ai-proposed' : undefined}
                    />
                  </div>
                  {canEdit && po.linkId && (
                    <IconBtn
                      title="Remove from this shipment"
                      disabled={busy}
                      onClick={() => setConfirmUnlinkId(po.id)}
                    >
                      <Link2Off size={14} />
                    </IconBtn>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
        {sorted.length === 0 && !(canEdit && adding) && (
          <tr>
            <td colSpan={colSpan} className="px-3 py-4 text-center text-sm text-text-muted">
              No POs on this shipment yet.
              {canEdit ? ' Use Add PO above.' : ' Click Edit to add POs.'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )

  if (embedded) {
    return (
      <div data-testid="review-po-styles-section" aria-label="POs and styles">
        {table}
      </div>
    )
  }

  return (
    <section
      className="max-w-full overflow-x-auto rounded-lg border border-border"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
      {table}
    </section>
  )
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-text-muted transition-colors hover:bg-surface-600 hover:text-text-primary disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function AddRow({
  onSave,
  onCancel,
  busy,
}: {
  onSave: (f: RowForm) => void
  onCancel: () => void
  busy: boolean
}) {
  const [f, setF] = useState<RowForm>({ poNumber: '', itemStyleNo: '' })
  const canSave = f.poNumber.trim().length > 0 && !busy
  const set = (k: keyof RowForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value })

  return (
    <tr className="border-b border-border bg-surface-900/40" data-testid="review-po-add-row">
      <td className={cn(REVIEW_COL.label, REVIEW_TD)}>
        <input
          autoFocus
          className={inputCls}
          placeholder="PO number"
          value={f.poNumber}
          onChange={set('poNumber')}
          aria-label="New PO number"
        />
      </td>
      <td className={cn(REVIEW_COL.existing, REVIEW_TD)}>
        <input
          className={inputCls}
          placeholder="Item / style"
          value={f.itemStyleNo}
          onChange={set('itemStyleNo')}
          aria-label="New item / style"
        />
      </td>
      <td className={cn(REVIEW_COL.proposed, REVIEW_TD)}>
        <div className="flex items-center justify-end gap-0.5">
          <IconBtn title="Save" disabled={!canSave} onClick={() => canSave && onSave(f)}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          </IconBtn>
          <IconBtn title="Cancel" onClick={onCancel}>
            <X size={14} />
          </IconBtn>
        </div>
      </td>
    </tr>
  )
}
