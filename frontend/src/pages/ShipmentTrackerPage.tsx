import { useState } from 'react'
import { useShipments } from '../hooks/use-shipments'
import { ShipmentTable } from '../components/shipments/ShipmentTable'
import { ShipmentFilters } from '../components/shipments/ShipmentFilters'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { Search, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

export default function ShipmentTrackerPage() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const { data, isLoading } = useShipments({ status: statusFilter })
  const qc = useQueryClient()

  const allShipments = data?.shipments ?? []

  // Multi-term search: space- or comma-separated, any term matches (OR)
  const filtered = search
    ? allShipments.filter((s) => {
        const terms = search.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
        if (terms.length === 0) return true
        const fields = [
          s.poNumbers,
          s.customer?.name,
          s.forwarder?.name,
          s.vendor?.name,
          s.route,
          s.bookingNo,
          s.soNumber,
          s.containerNo,
          s.hblNumber,
          s.mblNumber,
          s.vesselName,
          s.voyageNumber,
          s.consigneeName,
          s.scacCode,
          s.originCountry,
          s.status,
        ]
        return terms.some((q) => fields.some((f) => f?.toLowerCase().includes(q)))
      })
    : allShipments

  const { totalItems, totalPages, pageSize, getPage } = usePagination(filtered, perPage)
  const pageShipments = getPage(page)

  const handleFilterChange = (v: string) => {
    setStatusFilter(v)
    setPage(1)
  }

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }

  const handlePageSizeChange = (size: number) => {
    setPerPage(size)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Shipment Tracker</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => qc.invalidateQueries({ queryKey: ['shipments'] })}
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
          placeholder="Search — PO#, customer, route, booking#, container, SCAC… (comma or space for multiple)"
          className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      <ShipmentFilters value={statusFilter} onChange={handleFilterChange} />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading shipments...</span>
        </div>
      ) : (
        <>
          <ShipmentTable shipments={pageShipments} />
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
