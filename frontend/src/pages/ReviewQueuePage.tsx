import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  RefreshCw,
  Ship,
  Package,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { useReviewQueue, useConfirmShipment, type ReviewShipment } from '../hooks/use-review-queue'
import { Badge } from '../components/ui/Badge'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { formatRelativeTime } from '../lib/utils'
import { useState } from 'react'

/** Small chip explaining WHY a provisional shipment is held for review. */
function ReasonChip({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-status-warning">
      <AlertTriangle size={9} className="shrink-0" />
      {reason}
    </span>
  )
}

export default function ReviewQueuePage() {
  const { data, isLoading, isError } = useReviewQueue()
  const confirmMutation = useConfirmShipment()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const shipments = data?.shipments ?? []
  const { totalItems, totalPages, pageSize, getPage } = usePagination(shipments, perPage)
  const pageShipments = getPage(page)

  const handleApprove = (id: string) => {
    setConfirmingId(id)
    confirmMutation.mutate(id, {
      onSettled: () => setConfirmingId(null),
    })
  }

  const handlePageSizeChange = (size: number) => {
    setPerPage(size)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Review Queue</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            Provisional shipments awaiting confirmation — resolve the flagged reasons, then approve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['review-queue'] })
              qc.invalidateQueries({ queryKey: ['review-counts'] })
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <PageSizeSelect value={perPage} onChange={handlePageSizeChange} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-text-muted">Loading review queue...</span>
        </div>
      ) : isError ? (
        <div className="flex h-64 items-center justify-center">
          <span className="text-sm text-status-critical">Failed to load the review queue.</span>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-surface-800">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-surface-900/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Booking</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Route</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Why review?</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageShipments.map((s: ReviewShipment) => {
                    const isConfirming = confirmingId === s.id
                    return (
                      <tr
                        key={s.id}
                        onClick={() => navigate(`/shipments/${s.id}`)}
                        className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                      >
                        {/* Customer */}
                        <td className="px-4 py-3 text-sm text-text-secondary">
                          {s.customer ?? '—'}
                          {s.forwarder && (
                            <span className="mt-0.5 block text-[11px] text-text-muted">{s.forwarder}</span>
                          )}
                        </td>

                        {/* Booking / SO */}
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-medium text-cobalt-primary-light">
                            <Ship size={13} className="shrink-0 text-text-muted" />
                            {s.bookingNo ?? s.soNo ?? '—'}
                          </span>
                          {s.poCount > 0 && (
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-text-muted">
                              <Package size={10} />
                              {s.poCount} PO{s.poCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </td>

                        {/* Route */}
                        <td className="px-4 py-3 text-sm text-text-secondary">
                          {s.route ?? '—'}
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <Badge variant="status" value={s.status} />
                        </td>

                        {/* Review reasons */}
                        <td className="px-4 py-3">
                          {s.reviewReasons.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {s.reviewReasons.map((r, i) => (
                                <ReasonChip key={`${s.id}-${i}`} reason={r} />
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                          <span className="mt-1 block text-[10px] text-text-muted">
                            {formatRelativeTime(s.createdAt)}
                          </span>
                        </td>

                        {/* Approve */}
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleApprove(s.id)
                            }}
                            disabled={confirmMutation.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/15 px-2.5 py-1.5 text-xs font-medium text-status-success transition-colors hover:bg-status-success/25 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isConfirming ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <CheckCircle size={13} />
                            )}
                            Approve
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {pageShipments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <CheckCircle size={28} className="opacity-40" />
                          <span className="text-sm">No shipments awaiting review.</span>
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
    </div>
  )
}
