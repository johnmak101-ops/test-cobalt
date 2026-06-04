import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePurchaseOrders, useCreatePurchaseOrder } from '../hooks/use-purchase-orders'
import { cn } from '../lib/utils'
import { Package, Plus, Search } from 'lucide-react'

export default function PurchaseOrdersPage() {
  const navigate = useNavigate()
  const { data, isLoading } = usePurchaseOrders()
  const createPO = useCreatePurchaseOrder()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newPO, setNewPO] = useState({ poNumber: '', totalQuantity: '', quantityUnit: 'cartons' })

  const purchaseOrders = data?.purchaseOrders ?? []

  const filtered = search
    ? purchaseOrders.filter(
        (po) =>
          po.poNumber.toLowerCase().includes(search.toLowerCase()) ||
          po.customer?.name.toLowerCase().includes(search.toLowerCase()) ||
          po.vendor?.name.toLowerCase().includes(search.toLowerCase())
      )
    : purchaseOrders

  const handleCreate = () => {
    if (!newPO.poNumber.trim()) return
    createPO.mutate(
      {
        poNumber: newPO.poNumber.trim(),
        totalQuantity: newPO.totalQuantity ? parseFloat(newPO.totalQuantity) : undefined,
        quantityUnit: newPO.quantityUnit,
      },
      {
        onSuccess: () => {
          setNewPO({ poNumber: '', totalQuantity: '', quantityUnit: 'cartons' })
          setShowCreate(false)
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Purchase Orders</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Track POs across multiple partial shipments
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-2 text-sm font-medium text-white hover:bg-cobalt-primary-light"
        >
          <Plus size={14} />
          New PO
        </button>
      </div>

      {/* Quick create form */}
      {showCreate && (
        <div className="rounded-xl border border-border bg-surface-800 p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Create Purchase Order</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-text-muted">PO Number *</label>
              <input
                type="text"
                value={newPO.poNumber}
                onChange={(e) => setNewPO({ ...newPO, poNumber: e.target.value })}
                placeholder="e.g. PO-2024-001"
                className="mt-1 block h-9 w-48 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">Total Quantity</label>
              <input
                type="number"
                value={newPO.totalQuantity}
                onChange={(e) => setNewPO({ ...newPO, totalQuantity: e.target.value })}
                placeholder="0"
                className="mt-1 block h-9 w-28 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary placeholder:text-text-muted"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">Unit</label>
              <select
                value={newPO.quantityUnit}
                onChange={(e) => setNewPO({ ...newPO, quantityUnit: e.target.value })}
                className="mt-1 block h-9 rounded-lg border border-border bg-surface-700 px-3 text-sm text-text-primary"
              >
                <option value="cartons">Cartons</option>
                <option value="pieces">Pieces</option>
                <option value="cbm">CBM</option>
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={!newPO.poNumber.trim() || createPO.isPending}
              className="h-9 rounded-lg bg-cobalt-primary px-4 text-sm font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50"
            >
              {createPO.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
          {createPO.isError && (
            <p className="mt-2 text-xs text-status-critical">
              {createPO.error?.message ?? 'Failed to create PO'}
            </p>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PO#, customer, or vendor..."
          className="h-9 w-full max-w-md rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-text-muted">
          Loading purchase orders...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-text-muted">
          <Package size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No purchase orders found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-900/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">PO#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Vendor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Quantity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Shipped
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Shipments
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((po) => {
                  const progress =
                    po.totalQuantity && po.shippedQuantity
                      ? Math.min((po.shippedQuantity / po.totalQuantity) * 100, 100)
                      : 0

                  return (
                    <tr
                      key={po.id}
                      onClick={() => navigate(`/purchase-orders/${po.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700"
                    >
                      <td className="px-4 py-3 font-mono text-sm font-medium text-cobalt-primary-light">
                        {po.poNumber}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {po.customer?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {po.vendor?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-text-secondary">
                        {po.totalQuantity != null
                          ? `${po.totalQuantity} ${po.quantityUnit ?? ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-text-secondary">
                        {po.shippedQuantity != null && po.shippedQuantity > 0
                          ? `${po.shippedQuantity} ${po.quantityUnit ?? ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {po.totalQuantity ? (
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-600">
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
                            <span className="font-mono text-xs text-text-muted">
                              {progress.toFixed(0)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-surface-600 px-2 font-mono text-xs text-text-secondary">
                          {po.shipmentCount ?? 0}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
