import { useState } from 'react'
import { Search, Package, Link2, FileText } from 'lucide-react'
import { useDocuments, type UnlinkedDocument } from '../hooks/use-documents'
import { Badge } from '../components/ui/Badge'
import { LinkShipmentModal } from '../components/documents/LinkShipmentModal'
import { DocumentDetailDrawer } from '../components/documents/DocumentDetailDrawer'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { formatShortDate } from '../lib/utils'

function formatQty(qty: number | null, unit: string | null): string {
  if (qty == null) return '—'
  return `${qty.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

/** Compact PO cell: "N POs" with the full list revealed on hover (mirrors ShipmentTable). */
function POCell({ poNumbers, poCount }: { poNumbers: string[]; poCount: number }) {
  return (
    <div className="group relative inline-block">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-600 px-2 py-0.5 text-xs font-medium text-text-secondary cursor-default">
        <Package size={12} className="text-text-muted" />
        {poCount} PO{poCount !== 1 ? 's' : ''}
      </span>
      {poCount > 0 && (
        <div className="pointer-events-none absolute left-0 top-full z-50 mt-1 hidden w-64 rounded-lg border border-border bg-surface-800 p-3 shadow-xl group-hover:pointer-events-auto group-hover:block">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Purchase Orders
          </p>
          <div className="flex flex-wrap gap-1.5">
            {poNumbers.map((po) => (
              <span
                key={po}
                className="rounded-md bg-surface-700 px-1.5 py-0.5 font-mono text-[11px] text-cobalt-primary-light"
              >
                {po}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function UnlinkedDocumentsPage() {
  const { data, isLoading, isError } = useDocuments()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [linkTarget, setLinkTarget] = useState<UnlinkedDocument | null>(null)
  const [inspectTarget, setInspectTarget] = useState<UnlinkedDocument | null>(null)

  const documents = data ?? []

  // Multi-term search (space/comma separated, OR match) — mirrors the Shipments/POs pages.
  const filtered = search
    ? documents.filter((d) => {
        const terms = search.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
        if (terms.length === 0) return true
        const fields = [
          d.customer,
          d.emailType,
          d.senderType,
          d.qtyUnit,
          ...d.poNumbers,
        ]
        return terms.some((q) => fields.some((f) => f?.toLowerCase().includes(q)))
      })
    : documents

  const { totalItems, totalPages, pageSize, getPage } = usePagination(filtered, perPage)
  const pageDocs = getPage(page)

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary">Unlinked Documents</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Orphan invoice &amp; misc emails with no shipment identity — link each to a shipment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          placeholder="Search — customer, PO#, email type, sender… (comma or space for multiple)"
          className="h-9 w-full rounded-lg border border-border bg-surface-800 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
        />
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading documents...</span>
        </div>
      ) : isError ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-status-critical">Failed to load documents.</span>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface-900/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Email Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Sender</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">PO#s</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Received</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageDocs.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => setInspectTarget(d)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {d.customer ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {d.emailType ? (
                          <Badge variant="emailType" value={d.emailType} />
                        ) : (
                          <span className="text-sm text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {d.senderType ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <POCell poNumbers={d.poNumbers} poCount={d.poCount} />
                      </td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {formatQty(d.qty, d.qtyUnit)}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {formatShortDate(d.receivedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setLinkTarget(d)
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary/15 px-2.5 py-1.5 text-xs font-medium text-cobalt-primary transition-colors hover:bg-cobalt-primary/25"
                        >
                          <Link2 size={13} />
                          Link
                        </button>
                      </td>
                    </tr>
                  ))}
                  {pageDocs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <FileText size={28} className="opacity-40" />
                          <span className="text-sm">
                            {search ? 'No documents match your search.' : 'No unlinked documents — inbox is clear.'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
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

      <DocumentDetailDrawer
        document={inspectTarget}
        onClose={() => setInspectTarget(null)}
        onLink={(doc) => {
          setInspectTarget(null)
          setLinkTarget(doc)
        }}
      />

      {linkTarget && (
        <LinkShipmentModal
          key={linkTarget.id}
          document={linkTarget}
          onClose={() => setLinkTarget(null)}
        />
      )}
    </div>
  )
}
