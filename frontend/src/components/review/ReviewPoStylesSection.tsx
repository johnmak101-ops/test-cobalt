/**
 * Review POs & styles — same CRUD pattern as Shipment Detail PurchaseOrdersCard
 * so operators already know the flow: Edit → pencil / Add → inline Save/Cancel.
 */
import { useState, type ReactNode } from 'react'
import { Check, Link2Off, Loader2, Pencil, Plus, X } from 'lucide-react'
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
  REVIEW_TABLE_CLASS,
  REVIEW_TD,
  REVIEW_TH,
} from './review-table-layout'
import { cn } from '../../lib/utils'

const inputCls =
  'w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

const HEADER_BTN =
  'inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'
const HEADER_BTN_SOLID =
  'bg-surface-700 text-text-secondary hover:bg-surface-600 hover:text-text-primary'
const HEADER_BTN_BORDER =
  'border border-border text-text-secondary hover:bg-surface-700 hover:text-text-primary'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Proposed style from review reasons — display-only reference column. */
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

interface RowForm {
  poNumber: string
  itemStyleNo: string
}

export interface ReviewPoStylesSectionProps {
  shipmentId: string
  linkedPOs: LinkedPO[]
  /** Customer on the shipment — used when adding a PO (same as detail card). */
  customerId?: string | null
  readOnly?: boolean
  reviewReasons?: string[]
  /** @deprecated Card-level edit no longer drives this strip; kept for call-site compatibility. */
  editing?: boolean
}

export function ReviewPoStylesSection({
  shipmentId,
  linkedPOs,
  customerId = null,
  readOnly = false,
  reviewReasons = [],
}: ReviewPoStylesSectionProps) {
  const create = useCreatePurchaseOrder()
  const update = useUpdatePurchaseOrder()
  const unlink = useUnlinkShipmentFromPO()
  const link = useLinkShipmentToPO()

  const [crudMode, setCrudMode] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmUnlinkId, setConfirmUnlinkId] = useState<string | null>(null)

  const busy =
    create.isPending || update.isPending || unlink.isPending || link.isPending

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )

  const exitCrud = () => {
    setCrudMode(false)
    setAdding(false)
    setEditingId(null)
    setConfirmUnlinkId(null)
  }

  const startAdd = () => {
    setAdding(true)
    setEditingId(null)
    setConfirmUnlinkId(null)
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

  const handleEdit = (id: string, f: RowForm) => {
    update.mutate(
      {
        id,
        poNumber: f.poNumber.trim(),
        itemStyleNo: f.itemStyleNo.trim() || null,
      },
      {
        onSuccess: () => {
          toast(`Updated PO ${f.poNumber.trim()}`)
          setEditingId(null)
        },
        onError: () => toast.error('Update failed — please retry'),
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

  const colSpan = crudMode ? 4 : 3

  return (
    <section
      className="max-w-full rounded-lg border border-border"
      data-testid="review-po-styles-section"
      aria-label="POs and styles"
    >
      {/* Header row — same idea as PurchaseOrdersCard: title left, Edit / Done right */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-900/30 px-3 py-1.5">
        <h4 className={cn(REVIEW_GROUP_HEADER, 'px-0 py-0')}>
          POs & styles
          <span className="ml-2 font-normal normal-case tracking-normal">
            ({sorted.length} {sorted.length === 1 ? 'PO' : 'POs'})
          </span>
        </h4>
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1.5">
            {crudMode ? (
              <>
                <button
                  type="button"
                  onClick={startAdd}
                  disabled={busy}
                  className={cn(HEADER_BTN, HEADER_BTN_BORDER)}
                  data-testid="review-po-add"
                >
                  <Plus size={13} /> Add PO
                </button>
                <button
                  type="button"
                  onClick={exitCrud}
                  disabled={busy}
                  className={cn(HEADER_BTN, HEADER_BTN_SOLID)}
                  data-testid="review-po-crud-done"
                >
                  <X size={13} /> Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setCrudMode(true)}
                className={cn(HEADER_BTN, HEADER_BTN_SOLID)}
                data-testid="review-po-crud-edit"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>

      <div className="max-w-full overflow-x-auto">
        <table className={REVIEW_TABLE_CLASS}>
          <thead>
            <tr className="border-b border-border bg-surface-900/50">
              <th className={cn(REVIEW_COL.label, REVIEW_TH)}>PO#</th>
              <th className={cn(REVIEW_COL.existing, REVIEW_TH)}>Current style</th>
              <th className={cn(REVIEW_COL.proposed, REVIEW_TH)}>From email / AI</th>
              {crudMode && <th className="w-px px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {crudMode && adding && (
              <EditableRow
                busy={busy}
                onCancel={() => setAdding(false)}
                onSave={handleAdd}
              />
            )}
            {sorted.map((po) => {
              const proposed = proposedStyleForPo(po.poNumber, reviewReasons)
              const current = po.itemStyleNo?.trim() || null

              if (crudMode && editingId === po.id) {
                return (
                  <EditableRow
                    key={po.id}
                    po={po}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(f) => handleEdit(po.id, f)}
                  />
                )
              }

              if (crudMode && confirmUnlinkId === po.id) {
                return (
                  <tr
                    key={po.id}
                    className="border-b border-border bg-surface-900/40"
                    data-testid={`review-po-unlink-confirm-${po.id}`}
                  >
                    <td colSpan={colSpan} className="px-3 py-2 text-xs text-text-secondary">
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
                  className="border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                >
                  <td className={cn(REVIEW_TD, 'font-mono text-sm text-cobalt-primary-light')}>
                    <a
                      href={`/purchase-orders/${po.id}`}
                      className="field-value hover:underline"
                    >
                      {po.poNumber}
                    </a>
                  </td>
                  <td className={cn(REVIEW_TD, 'font-mono text-sm text-text-secondary')}>
                    <span className="field-value">{current ?? '—'}</span>
                  </td>
                  <td className={REVIEW_TD}>
                    <span
                      className={cn(
                        'field-value font-mono text-sm',
                        proposed ? 'font-medium text-ai-proposed' : 'text-text-muted',
                      )}
                    >
                      {proposed ?? '—'}
                    </span>
                  </td>
                  {crudMode && (
                    <td className="px-2 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconBtn
                          title="Edit PO"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(po.id)
                            setAdding(false)
                            setConfirmUnlinkId(null)
                          }}
                        >
                          <Pencil size={14} />
                        </IconBtn>
                        {po.linkId && (
                          <IconBtn
                            title="Remove from this shipment"
                            disabled={busy}
                            onClick={() => {
                              setConfirmUnlinkId(po.id)
                              setEditingId(null)
                              setAdding(false)
                            }}
                          >
                            <Link2Off size={14} />
                          </IconBtn>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
            {sorted.length === 0 && !(crudMode && adding) && (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-3 py-4 text-center text-xs text-text-muted"
                >
                  No POs on this shipment yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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

/** Same inline add/edit row as PurchaseOrdersCard — PO# + Item/Style + Save/Cancel. */
function EditableRow({
  po,
  onSave,
  onCancel,
  busy,
}: {
  po?: LinkedPO
  onSave: (f: RowForm) => void
  onCancel: () => void
  busy: boolean
}) {
  const [f, setF] = useState<RowForm>({
    poNumber: po?.poNumber ?? '',
    itemStyleNo: po?.itemStyleNo ?? '',
  })
  const canSave = f.poNumber.trim().length > 0 && !busy
  const set = (k: keyof RowForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value })

  return (
    <tr
      className="border-b border-border bg-surface-900/40"
      data-testid={po ? `review-po-edit-${po.id}` : 'review-po-add-row'}
    >
      <td className="px-3 py-2">
        <input
          autoFocus
          className={inputCls}
          placeholder="PO number"
          value={f.poNumber}
          onChange={set('poNumber')}
          aria-label={po ? `PO number for ${po.poNumber}` : 'New PO number'}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={inputCls}
          placeholder="Item / style"
          value={f.itemStyleNo}
          onChange={set('itemStyleNo')}
          aria-label={po ? `Style for PO ${po.poNumber}` : 'New item / style'}
        />
      </td>
      <td className="px-3 py-2 text-xs text-text-muted">—</td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-0.5">
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
