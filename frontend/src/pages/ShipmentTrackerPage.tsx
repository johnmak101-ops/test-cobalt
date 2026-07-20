import { useMemo, useState } from 'react'
import { useShipments } from '../hooks/use-shipments'
import { ShipmentTable } from '../components/shipments/ShipmentTable'
import { ShipmentFilters } from '../components/shipments/ShipmentFilters'
import { NewShipmentModal } from '../components/shipments/NewShipmentModal'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { Search, Plus } from 'lucide-react'
import { isIncompleteShell } from '../lib/incomplete-shell'
import { cn } from '../lib/utils'

export default function ShipmentTrackerPage() {
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [showNew, setShowNew] = useState(false)
  /** Hide incomplete shells (no strong key ∧ no master). Count chip always visible — never silent hide. */
  const [hideShells, setHideShells] = useState(false)
  const { data, isLoading } = useShipments({ status: statusFilter })

  const allShipments = data?.shipments ?? []

  const shellCount = useMemo(
    () => allShipments.filter((s) => isIncompleteShell(s)).length,
    [allShipments],
  )

  // Multi-term search: space- or comma-separated, any term matches (OR)
  const filtered = useMemo(() => {
    let list = allShipments
    if (hideShells) list = list.filter((s) => !isIncompleteShell(s))
    if (!search) return list
    const terms = search.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
    if (terms.length === 0) return list
    return list.filter((s) => {
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
  }, [allShipments, hideShells, search])

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

  const toggleHideShells = () => {
    setHideShells((v) => !v)
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
            New shipment
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
          placeholder="Search — PO#, customer, route, booking#, container, SCAC… (comma or space for multiple)"
          className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ShipmentFilters value={statusFilter} onChange={handleFilterChange} />
        {/* Parse-identity P5: incomplete-shell filter behind a count chip (never silently hidden). */}
        <button
          type="button"
          onClick={toggleHideShells}
          title={
            hideShells
              ? 'Showing only legs with a strong key or master party. Click to show incomplete shells.'
              : 'Click to hide incomplete shells (no booking/SO/HBL/MBL/container and no master party).'
          }
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            hideShells
              ? 'bg-amber-600/90 text-white'
              : 'bg-surface-700 text-text-secondary hover:bg-surface-600 hover:text-text-primary',
          )}
        >
          {hideShells ? 'Shells hidden' : 'Hide incomplete shells'}
          <span
            className={cn(
              'ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
              hideShells ? 'bg-white/20 text-white' : 'bg-surface-600 text-text-muted',
            )}
          >
            {shellCount}
          </span>
        </button>
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
