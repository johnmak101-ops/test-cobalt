import { useMemo, useState } from 'react'
import { useShipments } from '../hooks/use-shipments'
import { ShipmentTable } from '../components/shipments/ShipmentTable'
import { ShipmentFilters } from '../components/shipments/ShipmentFilters'
import { NewShipmentModal } from '../components/shipments/NewShipmentModal'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { formatShipmentId } from '../lib/utils'
import { Search, Plus } from 'lucide-react'

export default function ShipmentTrackerPage() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [showNew, setShowNew] = useState(false)
  const { data, isLoading } = useShipments({ status: statusFilter })

  const allShipments = data?.shipments ?? []

  // Multi-term search: space- or comma-separated, any term matches (OR)
  const filtered = useMemo(() => {
    const list = allShipments
    if (!search) return list
    const terms = search.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
    if (terms.length === 0) return list
    return list.filter((s) => {
      const fields = [
        formatShipmentId(s.id, s.firstEmailAt ?? s.createdAt), // #348/#350: what the Shipment ID column shows
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
  }, [allShipments, search])

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-text-primary">Shipment Tracker</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light"
          >
            <Plus size={14} />
            New Shipment
          </button>
          <PageSizeSelect value={perPage} onChange={handlePageSizeChange} />
        </div>
      </div>

      {showNew && <NewShipmentModal onClose={() => setShowNew(false)} />}

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search — shipment ID, PO#, customer, route, booking#, container, SCAC… (comma or space for multiple)"
          className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ShipmentFilters value={statusFilter} onChange={handleFilterChange} />
      </div>

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
