import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePurchaseOrders } from '../hooks/use-purchase-orders'
import { cn } from '../lib/utils'
import { formatDate } from '../lib/utils'
import { poProgress, furthestStatusLabel, type PoShipmentLink } from '../lib/po-progress'
import { Package, Search, Download, Calendar, AlertTriangle } from 'lucide-react'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'

export default function PurchaseOrdersPage() {
  const navigate = useNavigate()
  const { data, isLoading } = usePurchaseOrders()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)

  const purchaseOrders = data?.purchaseOrders ?? []

  // Filter by search term (multi-term: space- or comma-separated, any term matches)
  const searchFiltered = search
    ? purchaseOrders.filter((po) => {
        const terms = search.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
        if (terms.length === 0) return true
        const poFields = [
          po.poNumber,
          po.customer?.name,
          po.vendor?.name,
          po.quantityUnit,
          po.notes,
        ]
        const shipmentFields = (po.shipmentSummary ?? []).flatMap((s) => [
          s.bookingNo,
          s.route,
          s.containerNo,
          s.hblNumber,
          s.mblNumber,
          s.scacCode,
          s.vesselName,
          s.status,
        ])
        const allFields = [...poFields, ...shipmentFields]
        return terms.some((q) => allFields.some((f) => f?.toLowerCase().includes(q)))
      })
    : purchaseOrders

  // Filter by date range (based on createdAt)
  const filtered = useMemo(() => {
    let result = searchFiltered
    if (dateFrom) {
      const from = new Date(dateFrom)
      result = result.filter((po) => new Date(po.createdAt) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo)
      to.setHours(23, 59, 59, 999)
      result = result.filter((po) => new Date(po.createdAt) <= to)
    }
    return result
  }, [searchFiltered, dateFrom, dateTo])

  // Sort by PO number
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => a.poNumber.localeCompare(b.poNumber))
  }, [filtered])

  const { totalItems, totalPages, pageSize, getPage } = usePagination(sorted, perPage)
  const pageItems = getPage(page)

  const handleSearch = (v: string) => {
    setSearch(v)
    setPage(1)
  }

  const handlePageSizeChange = (size: number) => {
    setPerPage(size)
    setPage(1)
  }

  const clearDateFilter = () => {
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const api = (await import('../lib/api')).api
      const detailRows: string[][] = []

      // Same lifecycle-weighted progress as the table — prefer per-link detail, fall back to the summary.
      const progressCell = (po: (typeof sorted)[number], links?: PoShipmentLink[]) => {
        const ls = links?.length
          ? links
          : po.shipmentSummary?.length
            ? po.shipmentSummary
            : po.status
              ? [{ status: po.status }]
              : []
        if (ls.length === 0 && !po.totalQuantity) return ''
        const pct = Math.round(Math.min(100, Math.max(0, poProgress(po.totalQuantity, ls).pct)))
        const stage = furthestStatusLabel(ls)
        return `${pct}% ${stage}`
      }

      // "CNSZX→GBFXT" → two filterable cells (arrows defeat spreadsheet filters). A missing end comes
      // through as the "-" placeholder (deriveRoute, #115) — drop it so the export cell stays empty.
      const splitRoute = (r?: string | null): [string, string] => {
        const [pol = '', pod = ''] = (r ?? '').split('→')
        const cell = (x: string): string => {
          const t = x.trim()
          return t === '-' ? '' : t
        }
        return [cell(pol), cell(pod)]
      }

      for (const po of sorted) {
        try {
          const detail: any = await api.get(`/purchase-orders/${po.id}`)
          const shipments = detail.linkedShipments ?? []

          if (shipments.length === 0) {
            // PO with no linked shipments — one row with PO data, empty shipment fields
            detailRows.push([
              po.poNumber,
              po.customer?.name ?? '',
              po.vendor?.name ?? '',
              String(po.totalQuantity ?? ''),
              po.quantityUnit ?? '',
              String(po.shippedQuantity ?? ''),
              progressCell(po),
              formatDate(po.createdAt),
              // Shipment fields (empty)
              '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
            ])
          } else {
            // One row per shipment with full shipment detail
            for (const s of shipments) {
              detailRows.push([
                po.poNumber,
                po.customer?.name ?? '',
                po.vendor?.name ?? '',
                String(po.totalQuantity ?? ''),
                po.quantityUnit ?? '',
                String(po.shippedQuantity ?? ''),
                progressCell(po, shipments),
                formatDate(po.createdAt),
                // Shipment detail fields
                s.bookingNo ?? '',
                s.soNumber ?? '',
                s.itemStyleNo ?? '',
                s.status ?? '',
                s.riskLevel ?? '',
                ...splitRoute(s.route),
                String(s.quantityShipped ?? ''),
                s.quantityUnit ?? '',
                String(s.linkedQuantity ?? ''),
                s.customer?.name ?? '',
                s.vendor?.name ?? '',
                s.forwarder?.name ?? '',
                s.consigneeName ?? '',
                s.consigneeAddress ?? '',
                s.containerNo ?? '',
                s.hblNumber ?? '',
                s.mblNumber ?? '',
                s.scacCode ?? '',
                s.vesselName ?? '',
                s.voyageNumber ?? '',
                s.warehouseAddress ?? '',
                s.crd ? formatDate(s.crd) : '',
                s.cfsCutoff ? formatDate(s.cfsCutoff) : '',
                s.etd ? formatDate(s.etd) : '',
                s.eta ? formatDate(s.eta) : '',
                s.actualDeparture ? formatDate(s.actualDeparture) : '',
                s.actualArrival ? formatDate(s.actualArrival) : '',
                s.warehouseStartDate ? formatDate(s.warehouseStartDate) : '',
                s.warehouseEndDate ? formatDate(s.warehouseEndDate) : '',
                s.inDcDate ? formatDate(s.inDcDate) : '',
              ])
            }
          }
        } catch {
          detailRows.push([
            po.poNumber,
            po.customer?.name ?? '',
            po.vendor?.name ?? '',
            String(po.totalQuantity ?? ''),
            po.quantityUnit ?? '',
            String(po.shippedQuantity ?? ''),
            progressCell(po),
            formatDate(po.createdAt),
            '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
          ])
        }
      }

      const headers = [
        // PO fields
        'Customer PO#',
        'Customer',
        'Vendor',
        'Total Qty',
        'UOM',
        'Qty On Shipments',
        'Progress',
        'PO Created Date',
        // Shipment detail fields
        'Booking No',
        'SO#',
        'Item/Style No',
        'Shipment Status',
        'Risk Level',
        'POL',
        'POD',
        'Qty Shipped',
        'Shipment UOM',
        'Linked Qty',
        'Customer (Shipment)',
        'Vendor (Shipment)',
        'Forwarder',
        'Consignee Name',
        'Consignee Address',
        'Container No',
        'HBL/AWB/FCR No',
        'MBL No',
        'SCAC Code',
        'Vessel Name',
        'Voyage No',
        'Warehouse Address',
        'CRD',
        'CFS Cutoff',
        'ETD',
        'ETA',
        'ATD',
        'ATA',
        'WH Start Date',
        'WH End Date',
        'In DC Date',
      ]

      const escape = (v: string) => {
        if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`
        return v
      }
      const csv = [headers.map(escape).join(','), ...detailRows.map((r) => r.map(escape).join(','))].join('\n')
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      const dateLabel = dateFrom || dateTo ? `_${dateFrom || 'start'}-${dateTo || 'end'}` : ''
      link.download = `customer_purchase_orders${dateLabel}.csv`
      link.click()
      URL.revokeObjectURL(link.href)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text-primary">Customer Purchase Orders</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Track customer POs across multiple partial shipments
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageSizeSelect value={perPage} onChange={handlePageSizeChange} />
        </div>
      </div>

      {/* Search + Date Filter + Export */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search — PO#, customer, vendor, route, booking#, container, SCAC… (comma or space for multiple)"
            className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Calendar size={14} className="text-text-muted" />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="h-9 w-full rounded-lg border border-border bg-surface-800 px-2 text-sm text-text-primary sm:w-auto"
            placeholder="From"
          />
          <span className="text-text-muted text-xs">—</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="h-9 w-full rounded-lg border border-border bg-surface-800 px-2 text-sm text-text-primary sm:w-auto"
            placeholder="To"
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={clearDateFilter}
              className="h-9 rounded-lg border border-border bg-surface-700 px-2 text-xs text-text-secondary hover:bg-surface-600 hover:text-text-primary"
            >
              Clear
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || filtered.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-cobalt-primary-light disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download size={14} />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      {/* Results count */}
      {(dateFrom || dateTo || search) && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {purchaseOrders.length} POs
          {dateFrom && ` from ${dateFrom}`}
          {dateTo && ` to ${dateTo}`}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-text-muted">
          Loading customer purchase orders...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-32 flex-col items-center justify-center text-text-muted">
          <Package size={24} className="mb-2 opacity-50" />
          <p className="text-sm">No customer purchase orders found</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-surface-900/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer PO#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Customer
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
                    Vendor
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">
                    Quantity
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">
UOM
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
                  // Progress aligns with shipment lifecycle: qty-weighted over the linked shipments'
                  // states when the per-shipment split is known, else the furthest shipment's state.
                  const links: PoShipmentLink[] = po.shipmentSummary?.length
                    ? po.shipmentSummary
                    : po.status
                      ? [{ status: po.status }]
                      : []
                  const progress = poProgress(po.totalQuantity, links).pct
                  const pctRounded = Math.round(Math.min(100, Math.max(0, progress)))
                  const hasProgress = !!(po.totalQuantity || links.length > 0)

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
                      <td className="px-4 py-3 font-mono text-sm text-right text-text-secondary">
                        {po.shippedQuantity || po.totalQuantity || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {po.quantityUnit ?? po.shippedUnit ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {hasProgress ? (
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-surface-600">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  pctRounded >= 100
                                    ? 'bg-status-success'
                                    : pctRounded > 0
                                      ? 'bg-cobalt-primary'
                                      : 'bg-surface-600'
                                )}
                                style={{ width: `${pctRounded}%` }}
                              />
                            </div>
                            <span className="whitespace-nowrap font-mono text-xs text-text-secondary">
                              {po.totalQuantity || links.length ? `${pctRounded}%` : '—'}
                            </span>
                            <span className="truncate text-xs text-text-muted capitalize">
                              {furthestStatusLabel(links)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-surface-600 px-2 font-mono text-xs text-text-secondary">
                            {po.shipmentCount ?? 0}
                          </span>
                          {po.shipmentSummary?.some((s) => s.reviewStatus === 'provisional') && (
                            <span title="Linked shipment awaiting review" className="inline-flex shrink-0">
                              <AlertTriangle size={13} className="text-status-warning" />
                            </span>
                          )}
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