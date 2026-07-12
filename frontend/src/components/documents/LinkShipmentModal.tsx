import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Search, Ship, Link2, Loader2 } from 'lucide-react'
import { useShipments, type Shipment } from '../../hooks/use-shipments'
import { useLinkDocument, type UnlinkedDocument } from '../../hooks/use-documents'
import { Badge } from '../ui/Badge'
import { formatShortDate } from '../../lib/utils'

/** Manual "Link to shipment" picker for an orphan document. Candidate shipments come from the
 *  existing shipments endpoint (same one the Shipment Tracker uses) and are filtered client-side
 *  by booking#, customer, or route as the user types.
 *
 *  Parent should remount on document change via `key={doc.id}` so search/selection start clean
 *  (avoids setState-in-effect reset). */
export function LinkShipmentModal({
  document: doc,
  onClose,
}: {
  document: UnlinkedDocument | null
  onClose: () => void
}) {
  const { data, isLoading, isError } = useShipments()
  const linkMutation = useLinkDocument()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Stable reference so the `filtered` memo below doesn't recompute every render (`?? []` would otherwise
  // mint a fresh empty array each time while shipments are loading).
  const allShipments = useMemo(() => data?.shipments ?? [], [data?.shipments])

  // Multi-term client-side filter — mirrors ShipmentTrackerPage: space/comma-separated, OR match.
  const filtered = useMemo(() => {
    if (!search) return allShipments
    const terms = search.toLowerCase().trim().split(/[\s,]+/).filter(Boolean)
    if (terms.length === 0) return allShipments
    return allShipments.filter((s) => {
      const fields = [s.bookingNo, s.soNumber, s.customer?.name, s.route, s.poNumbers]
      return terms.some((q) => fields.some((f) => f?.toLowerCase().includes(q)))
    })
  }, [allShipments, search])

  if (!doc) return null

  const handleConfirm = () => {
    if (!selectedId) return
    linkMutation.mutate(
      { documentId: doc.id, shipmentId: selectedId },
      { onSuccess: () => onClose() },
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <Link2 size={16} className="mt-0.5 shrink-0 text-text-muted" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">Link document to shipment</h3>
              <p className="mt-0.5 text-xs text-text-muted">
                {doc.customer ?? 'Unknown customer'}
                {doc.poCount > 0 ? ` · ${doc.poCount} PO${doc.poCount !== 1 ? 's' : ''}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-border p-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shipments — booking#, customer, route… (comma or space for multiple)"
              className="h-9 w-full rounded-lg border border-border bg-surface-900 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted"
            />
          </div>
        </div>

        {/* Candidate list */}
        <div className="flex-1 overflow-auto p-2">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <span className="text-sm text-text-muted">Loading shipments…</span>
            </div>
          ) : isError ? (
            <div className="flex h-40 items-center justify-center">
              <span className="text-sm text-status-critical">Failed to load shipments.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <span className="text-sm text-text-muted">
                {search ? 'No shipments match your search.' : 'No shipments available.'}
              </span>
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((s: Shipment) => {
                const isSelected = s.id === selectedId
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedId(s.id)}
                      className={
                        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ' +
                        (isSelected
                          ? 'border-cobalt-primary bg-cobalt-primary/10'
                          : 'border-transparent hover:border-border hover:bg-surface-700')
                      }
                    >
                      <Ship size={16} className="shrink-0 text-text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-medium text-cobalt-primary-light">
                            {s.bookingNo ?? s.soNumber ?? '—'}
                          </span>
                          <Badge variant="status" value={s.status} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                          <span className="truncate">{s.customer?.name ?? 'Unknown customer'}</span>
                          {s.route && <span className="shrink-0">· {s.route}</span>}
                          <span className="shrink-0">· ETD {formatShortDate(s.etd)}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer / actions */}
        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <span className="text-xs text-status-critical">
            {linkMutation.isError ? 'Failed to link — please try again.' : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedId || linkMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
            >
              {linkMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Link to shipment
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
