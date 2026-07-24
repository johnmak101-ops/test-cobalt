import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Package, Pencil, Trash2, Link2Off, Plus, Check, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { toast } from '../ui/Toast'
import { cn } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'
import type { LinkedPO } from '../../hooks/use-shipments'
// Same structured Item/Style affordance as the review queue (StyleListEditor/Display share the
// parseStyleEntries vocabulary) — the card used to edit the list as one raw comma string (2026-07-24).
import { StyleListDisplay, StyleListEditor } from '../review/ConflictRow'
import {
  useCreatePurchaseOrder,
  useUpdatePurchaseOrder,
  useDeletePurchaseOrder,
  useLinkShipmentToPO,
  useUnlinkShipmentFromPO,
} from '../../hooks/use-purchase-orders'

const inputCls =
  'w-full rounded-md border border-border bg-surface-700 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

interface RowForm {
  poNumber: string
  itemStyleNo: string
}

/**
 * Customer Purchase Orders on the shipment detail page. Read-only by default; Edit enters CRUD mode
 * (add / edit / unlink / delete). Add creates a PO and links it to this shipment; inline Edit updates
 * PO#/style; Unlink removes the PO from THIS shipment; Delete removes the PO everywhere (both confirmed
 * inline). No per-PO qty/unit here — that comes from the packing list, which a shipment may not have yet.
 */
export function PurchaseOrdersCard({
  shipmentId,
  customerId,
  linkedPOs,
  shipmentQty,
  shipmentQtyUnit,
}: {
  shipmentId: string
  customerId: string | null
  linkedPOs: LinkedPO[]
  shipmentQty: number | null
  shipmentQtyUnit: string | null
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  /** When false, table is view-only (no Add / row actions). Edit button turns this on. */
  const [crudMode, setCrudMode] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; kind: 'delete' | 'unlink' } | null>(null)

  const create = useCreatePurchaseOrder()
  const update = useUpdatePurchaseOrder()
  const del = useDeletePurchaseOrder()
  const link = useLinkShipmentToPO()
  const unlink = useUnlinkShipmentFromPO()
  const busy =
    create.isPending || update.isPending || del.isPending || link.isPending || unlink.isPending

  const sorted = [...linkedPOs].sort((a, b) =>
    a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }),
  )
  const total = linkedPOs[0]?.sharedBroadcastTotal ?? shipmentQty
  const totalUnit = linkedPOs[0]?.sharedBroadcastUnit ?? shipmentQtyUnit

  const exitCrudMode = () => {
    setCrudMode(false)
    setAdding(false)
    setEditingId(null)
    setConfirm(null)
  }

  const startAdd = () => {
    setAdding(true)
    setEditingId(null)
    setConfirm(null)
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
                toast.success(`Added PO ${f.poNumber}`)
                setAdding(false)
              },
              onError: () => toast.error('Created the PO, but linking it to this shipment failed'),
            },
          )
        },
        onError: () => toast.error(`Couldn't add PO ${f.poNumber} — it may already exist`),
      },
    )
  }

  const handleEdit = (id: string, f: RowForm) => {
    update.mutate(
      { id, poNumber: f.poNumber.trim(), itemStyleNo: f.itemStyleNo.trim() || null },
      {
        onSuccess: () => {
          toast.success(`Updated PO ${f.poNumber}`)
          setEditingId(null)
        },
        onError: () => toast.error('Update failed — please retry'),
      },
    )
  }

  const handleConfirm = (po: LinkedPO) => {
    if (!confirm) return
    if (confirm.kind === 'delete') {
      del.mutate(po.id, {
        onSuccess: () => {
          toast.success(`Deleted PO ${po.poNumber}`)
          setConfirm(null)
        },
        onError: () => toast.error('Delete failed — please retry'),
      })
    } else {
      if (!po.linkId) {
        setConfirm(null)
        return toast.error('No shipment link to remove')
      }
      unlink.mutate(
        { poId: po.id, linkId: po.linkId },
        {
          onSuccess: () => {
            toast.success(`Removed PO ${po.poNumber} from this shipment`)
            setConfirm(null)
          },
          onError: () => toast.error('Remove failed — please retry'),
        },
      )
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          data-testid="pos-card-toggle"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={14} className="shrink-0 text-text-muted" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-text-muted" />
          )}
          <Package size={14} className="shrink-0 text-text-muted" />
          <h4 className="text-base font-semibold text-text-primary">
            Customer Purchase Orders
            <span className="ml-2 text-sm font-normal text-text-muted">
              · {linkedPOs.length} PO{linkedPOs.length !== 1 ? 's' : ''}
              {total != null && (
                <>
                  {' '}· shipment total{' '}
                  <span className="font-medium text-text-secondary">
                    {total}
                    {totalUnit ? ` ${totalUnit}` : ''}
                  </span>
                </>
              )}
            </span>
          </h4>
        </button>
        {expanded && (
          <div className="flex shrink-0 items-center gap-1.5">
            {crudMode ? (
              <>
                <button
                  type="button"
                  onClick={startAdd}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-700 hover:text-text-primary disabled:opacity-50"
                  data-testid="po-add"
                >
                  <Plus size={13} /> Add PO
                </button>
                <button
                  type="button"
                  onClick={exitCrudMode}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-700 hover:text-text-primary disabled:opacity-50"
                  data-testid="po-crud-done"
                >
                  <X size={13} /> Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setCrudMode(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
                data-testid="po-crud-edit"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border" data-testid="pos-card-table">
          <table className="w-full min-w-[22rem]">
            <thead>
              <tr className="border-b border-border bg-surface-900/50">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-text-muted">Customer PO#</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-text-muted">Item / Style</th>
                {crudMode && <th className="w-px px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {crudMode && adding && (
                <EditableRow busy={busy} onCancel={() => setAdding(false)} onSave={handleAdd} />
              )}
              {sorted.map((po) =>
                crudMode && editingId === po.id ? (
                  <EditableRow
                    key={po.id}
                    po={po}
                    busy={busy}
                    onCancel={() => setEditingId(null)}
                    onSave={(f) => handleEdit(po.id, f)}
                  />
                ) : crudMode && confirm?.id === po.id ? (
                  <ConfirmRow
                    key={po.id}
                    kind={confirm.kind}
                    poNumber={po.poNumber}
                    busy={busy}
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => handleConfirm(po)}
                  />
                ) : (
                  <tr
                    key={po.id}
                    data-testid={`po-row-${po.id}`}
                    className="border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                  >
                    <td className="min-w-0 px-3 py-2.5 font-mono text-base text-cobalt-primary-light">
                      <span
                        {...interactiveProps(() =>
                          navigate(`/purchase-orders/${po.id}`, { state: { fromShipment: shipmentId } }),
                        )}
                        className="field-value cursor-pointer hover:underline"
                      >
                        {po.poNumber}
                      </span>
                    </td>
                    <td className="min-w-0 px-3 py-2.5">
                      <StyleListDisplay value={po.itemStyleNo ?? ''} className="text-text-secondary" pairs={false} />
                    </td>
                    {crudMode && (
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconBtn
                            title="Edit PO"
                            disabled={busy}
                            onClick={() => {
                              setEditingId(po.id)
                              setConfirm(null)
                              setAdding(false)
                            }}
                          >
                            <Pencil size={14} />
                          </IconBtn>
                          {po.linkId && (
                            <IconBtn
                              title="Remove from this shipment"
                              disabled={busy}
                              onClick={() => setConfirm({ id: po.id, kind: 'unlink' })}
                            >
                              <Link2Off size={14} />
                            </IconBtn>
                          )}
                          <IconBtn
                            title="Delete PO everywhere"
                            danger
                            disabled={busy}
                            onClick={() => setConfirm({ id: po.id, kind: 'delete' })}
                          >
                            <Trash2 size={14} />
                          </IconBtn>
                        </div>
                      </td>
                    )}
                  </tr>
                ),
              )}
              {sorted.length === 0 && !(crudMode && adding) && (
                <tr>
                  <td colSpan={crudMode ? 3 : 2} className="px-3 py-4 text-center text-xs text-text-muted">
                    No POs on this shipment yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded p-1 text-text-muted transition-colors hover:bg-surface-600 disabled:opacity-40',
        danger ? 'hover:text-status-critical' : 'hover:text-text-primary',
      )}
    >
      {children}
    </button>
  )
}

/** Add (no `po`) or edit (with `po`) a PO inline — PO# + Item/Style. Per-PO qty/unit are not entered
 *  here (they come from the packing list, which a shipment may not have yet). */
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
  const set = (k: keyof RowForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  return (
    <tr className="border-b border-border bg-surface-900/40" data-testid={po ? `po-edit-${po.id}` : 'po-add-row'}>
      <td className="px-3 py-2">
        <input autoFocus className={inputCls} placeholder="PO number" value={f.poNumber} onChange={set('poNumber')} />
      </td>
      <td className="px-3 py-2">
        <StyleListEditor
          label="Item / Style"
          value={f.itemStyleNo}
          onChange={(v) => setF((prev) => ({ ...prev, itemStyleNo: v }))}
          existingValue={po?.itemStyleNo ?? ''}
          pairs={false}
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-0.5">
          <IconBtn title="Save" disabled={!canSave} onClick={() => canSave && onSave(f)}>
            <Check size={14} />
          </IconBtn>
          <IconBtn title="Cancel" onClick={onCancel}>
            <X size={14} />
          </IconBtn>
        </div>
      </td>
    </tr>
  )
}

function ConfirmRow({
  kind,
  poNumber,
  onConfirm,
  onCancel,
  busy,
}: {
  kind: 'delete' | 'unlink'
  poNumber: string
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <tr className="border-b border-border bg-surface-900/40" data-testid="po-confirm">
      <td colSpan={2} className="px-3 py-2 text-xs text-text-secondary">
        {kind === 'delete' ? (
          <>
            <span className="font-medium text-status-critical">Delete PO {poNumber} everywhere?</span> It is
            removed from all shipments — this can't be undone.
          </>
        ) : (
          <>
            Remove PO {poNumber} from <span className="font-medium text-text-primary">this shipment</span>? The PO
            itself stays.
          </>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="po-confirm-yes"
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium text-white transition-colors disabled:opacity-50',
              kind === 'delete' ? 'bg-status-critical hover:opacity-90' : 'bg-cobalt-primary hover:bg-cobalt-primary-light',
            )}
          >
            {kind === 'delete' ? 'Delete' : 'Remove'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-surface-700"
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  )
}
