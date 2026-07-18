import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { usePurchaseOrder } from '../hooks/use-purchase-orders'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { cn, formatShortDate, parsePONumbers } from '../lib/utils'
import { poProgress, progressLabel } from '../lib/po-progress'
import { ArrowLeft, AlertTriangle, Package, Ship } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const fromShipment = (location.state as { fromShipment?: string })?.fromShipment
  const { data: po, isLoading } = usePurchaseOrder(id!)

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Loading customer purchase order...</span>
      </div>
    )
  }

  if (!po) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Customer purchase order not found</span>
      </div>
    )
  }

  // Progress aligns with the linked shipments' lifecycle — booked-but-not-sailed is not "fulfilled".
  const { pct: progress, bookedQuantity, shippedQuantity } = poProgress(
    po.totalQuantity,
    po.linkedShipments ?? [],
  )
  const unassigned =
    po.totalQuantity != null
      ? Math.max(po.totalQuantity - (bookedQuantity ?? 0) - (shippedQuantity ?? 0), 0)
      : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate(fromShipment ? `/shipments/${fromShipment}` : '/purchase-orders')}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
        >
          <ArrowLeft size={14} />
          {fromShipment ? 'Back to Shipment' : 'Back to Customer POs'}
        </button>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words font-mono text-xl font-semibold text-text-primary">
              {po.poNumber}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {po.customer?.name ?? 'Unknown Customer'}
              {po.vendor && ` · Vendor: ${po.vendor.name}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Package size={16} className="text-cobalt-primary" />
            <span className="text-sm font-medium text-text-primary">Customer Purchase Order</span>
          </div>
        </div>
      </div>

      {/* Summary card */}
      <Card>
        <h4 className="mb-4 text-sm font-semibold text-text-primary">Shipment Progress</h4>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-6">
          <div>
            <span className="text-xs text-text-muted">Total Quantity</span>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">
              {po.totalQuantity != null ? po.totalQuantity : '—'}
            </p>
          </div>
          <div>
            <span className="text-xs text-text-muted">UOM</span>
            <p className="mt-0.5 text-lg font-semibold text-text-primary">
              {po.quantityUnit ?? '—'}
            </p>
          </div>
          <div>
            <span className="text-xs text-text-muted">Booked</span>
            <p className="mt-0.5 font-mono text-lg font-semibold text-status-warning">
              {bookedQuantity != null ? bookedQuantity : '—'}
            </p>
          </div>
          <div>
            <span className="text-xs text-text-muted">Shipped</span>
            <p className="mt-0.5 font-mono text-lg font-semibold text-cobalt-primary">
              {shippedQuantity != null ? shippedQuantity : '—'}
            </p>
          </div>
          <div>
            <span className="text-xs text-text-muted">Unassigned</span>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-secondary">
              {unassigned != null ? unassigned : '—'}
            </p>
          </div>
          <div>
            <span className="text-xs text-text-muted">Shipments</span>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">
              {po.linkedShipments?.length ?? 0}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        {po.totalQuantity != null && po.totalQuantity > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
              <span>Fulfillment Progress</span>
              <span className="font-mono">
                <span className="whitespace-nowrap text-text-secondary">
                  {Math.round(Math.min(100, Math.max(0, progress)))}%
                </span>
                <span className="ml-2 capitalize">
                  {progressLabel(po.totalQuantity, po.linkedShipments ?? [])}
                </span>
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-surface-600">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  progress >= 100
                    ? 'bg-status-success'
                    : progress > 0
                      ? 'bg-cobalt-primary'
                      : 'bg-surface-600'
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {/* Notes */}
      {po.notes && (
        <Card>
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Notes</h4>
          <p className="text-sm text-text-secondary">{po.notes}</p>
        </Card>
      )}

      {/* Review warning — quantities/dates above may still change while linked shipments await review */}
      {(po.linkedShipments?.some((s) => s.reviewStatus === 'provisional') ?? false) && (
        <div className="flex items-center gap-3 rounded-xl border border-status-warning/40 bg-status-warning/10 px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-status-warning" />
          <p className="text-sm text-status-warning">
            {po.linkedShipments!.filter((s) => s.reviewStatus === 'provisional').length} linked shipment(s)
            awaiting review — figures on this PO may still change.
          </p>
        </div>
      )}

      {/* Linked shipments */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Linked Shipments ({po.linkedShipments?.length ?? 0})
        </h3>

        {(!po.linkedShipments || po.linkedShipments.length === 0) ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-border bg-surface-800 text-text-muted">
            <Ship size={24} className="mb-2 opacity-50" />
            <p className="text-sm">No shipments linked to this PO</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-900/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Shipment PO#
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Route
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    ETD
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    ETA
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">
                    Qty
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
UOM
                  </th>
                </tr>
              </thead>
              <tbody>
                {po.linkedShipments.map((shipment) => (
                  <tr
                    key={shipment.linkId}
                    onClick={() => navigate(`/shipments/${shipment.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700"
                  >
                    <td className="px-4 py-3 font-mono text-sm font-medium text-cobalt-primary-light">
                      {parsePONumbers(shipment.poNumbers).join(', ')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant="status" value={shipment.status} />
                        {shipment.reviewStatus === 'provisional' && (
                          <Link
                            to={`/shipments/${shipment.id}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Awaiting review — open the shipment"
                            className="inline-flex shrink-0"
                          >
                            <AlertTriangle size={13} className="text-status-warning" />
                          </Link>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {shipment.route ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {formatShortDate(shipment.etd)}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {formatShortDate(shipment.eta)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-right text-text-secondary">
                      {shipment.linkedQuantity ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {po.quantityUnit ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
