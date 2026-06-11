import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePurchaseOrders } from '../hooks/use-purchase-orders'
import { cn } from '../lib/utils'
import { Package, Search, RefreshCw } from 'lucide-react'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { useQueryClient } from '@tanstack/react-query'

export default function PurchaseOrdersPage() {
  const navigate = useNavigate()
  const { data, isLoading } = usePurchaseOrders()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const qc = useQueryClient()

  const purchaseOrders = data?.purchaseOrders ?? []

  const filtered = search
    ? purchaseOrders.filter(
        (po) =>
          po.poNumber.toLowerCase().includes(search.toLowerCase()) ||
          po.customer?.name.toLowerCase().includes(search.toLowerCase()) ||
          po.vendor?.name.toLowerCase().includes(search.toLowerCase())
      )
    : purchaseOrders

  const { totalItems, totalPages, pageSize, getPage } = usePagination(filtered, perPage)
  const pageItems = getPage(page)

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }

  const handlePageSizeChange = (size: number) => {
    setPerPage(size)
    setPage(1)
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
        <div className="flex items-center gap-2">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['purchase-orders'] })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <PageSizeSelect value={perPage} onChange={handlePageSizeChange} />
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by PO#, customer, or vendor..."
          className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
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
        <>
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
                {pageItems.map((po) => {
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
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
