import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Ship, Package, Loader2, XCircle, RotateCcw } from 'lucide-react'
import {
  useReviewQueue,
  useReviewCounts,
  useConfirmShipment,
  useDismissShipments,
  useRestoreShipment,
  type ReviewShipment,
  type ReviewQueueView,
} from '../hooks/use-review-queue'
import { Badge } from '../components/ui/Badge'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { cn, formatRelativeTime } from '../lib/utils'
import {
  humanizeReasons,
  categoriesOf,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type ReasonCategory,
} from '../lib/review-reasons'

export default function ReviewQueuePage() {
  const [view, setView] = useState<ReviewQueueView>('pending')
  const { data, isLoading, isError } = useReviewQueue(view)
  const { data: counts } = useReviewCounts()
  const confirmMutation = useConfirmShipment()
  const dismissMutation = useDismissShipments()
  const restoreMutation = useRestoreShipment()
  const navigate = useNavigate()

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [category, setCategory] = useState<ReasonCategory | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState('')

  const shipments = data?.shipments ?? []

  // Chip counts over the CURRENT view (a shipment counts once per category it carries).
  const categoryCounts = useMemo(() => {
    const m = new Map<ReasonCategory, number>()
    for (const s of shipments) for (const c of categoriesOf(s.reviewReasons)) m.set(c, (m.get(c) ?? 0) + 1)
    return m
  }, [shipments])

  const filtered = useMemo(
    () => (category === 'all' ? shipments : shipments.filter((s) => categoriesOf(s.reviewReasons).has(category))),
    [shipments, category],
  )
  const { totalItems, totalPages, pageSize, getPage } = usePagination(filtered, perPage)
  const pageShipments = getPage(page)

  const resetSelection = () => setSelected(new Set())
  const switchView = (v: ReviewQueueView) => {
    setView(v)
    setCategory('all')
    setPage(1)
    resetSelection()
  }
  const pickCategory = (c: ReasonCategory | 'all') => {
    setCategory(c)
    setPage(1)
    resetSelection()
  }
  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))
  const toggleAll = () => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((s) => s.id)))

  const handleApprove = (id: string) => {
    setBusyId(id)
    confirmMutation.mutate({ shipmentId: id }, { onSettled: () => setBusyId(null) })
  }
  const handleDismissOne = (id: string) => {
    setBusyId(id)
    dismissMutation.mutate(
      { shipmentIds: [id] },
      {
        onSuccess: () => setSelected((prev) => { const next = new Set(prev); next.delete(id); return next }),
        onSettled: () => setBusyId(null),
      },
    )
  }
  const handleRestore = (id: string) => {
    setBusyId(id)
    restoreMutation.mutate({ shipmentId: id }, { onSettled: () => setBusyId(null) })
  }
  const handleDismissSelected = () => {
    if (selected.size === 0) return
    dismissMutation.mutate(
      { shipmentIds: [...selected], note: bulkNote },
      {
        onSuccess: () => {
          resetSelection()
          setBulkNote('')
        },
      },
    )
  }

  const anyMutating = confirmMutation.isPending || dismissMutation.isPending || restoreMutation.isPending
  const isPendingView = view === 'pending'
  const colSpan = isPendingView ? 7 : 6

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary">Review Queue</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {isPendingView
              ? 'Provisional shipments awaiting confirmation — resolve the flagged reasons, then approve. Dismiss what is not a real shipment (portal echoes, no-move notices).'
              : 'Dismissed items — ruled "not a trackable shipment". Restore anything dismissed by mistake.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View tabs */}
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(
              [
                { key: 'pending', label: `Pending${counts ? ` (${counts.provisional})` : ''}` },
                { key: 'dismissed', label: `Dismissed${counts ? ` (${counts.dismissed})` : ''}` },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => switchView(t.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  view === t.key
                    ? 'bg-cobalt-primary text-white'
                    : 'bg-surface-800 text-text-secondary hover:bg-surface-700 hover:text-text-primary',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <PageSizeSelect value={perPage} onChange={(size) => { setPerPage(size); setPage(1) }} />
        </div>
      </div>

      {/* Reason-category filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => pickCategory('all')}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            category === 'all'
              ? 'border-cobalt-primary bg-cobalt-primary/15 text-cobalt-primary-light'
              : 'border-border bg-surface-800 text-text-secondary hover:text-text-primary',
          )}
        >
          All ({shipments.length})
        </button>
        {CATEGORY_ORDER.filter((c) => (categoryCounts.get(c) ?? 0) > 0).map((c) => (
          <button
            key={c}
            onClick={() => pickCategory(c)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              category === c
                ? 'border-cobalt-primary bg-cobalt-primary/15 text-cobalt-primary-light'
                : 'border-border bg-surface-800 text-text-secondary hover:text-text-primary',
            )}
          >
            {CATEGORY_LABEL[c]} ({categoryCounts.get(c)})
          </button>
        ))}
      </div>

      {/* Bulk-dismiss bar (pending view, ≥1 selected) */}
      {isPendingView && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-800 p-3">
          <span className="text-xs font-medium text-text-primary">{selected.size} selected</span>
          <input
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            placeholder="Optional note (e.g. portal echo — no carrier move)"
            className="h-8 min-w-56 flex-1 rounded-lg border border-border bg-surface-900 px-3 text-xs text-text-primary placeholder:text-text-muted"
          />
          <button
            onClick={handleDismissSelected}
            disabled={anyMutating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-3 py-1.5 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dismissMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
            Dismiss {selected.size} — not shipments
          </button>
          <button
            onClick={resetSelection}
            className="rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        </div>
      )}

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
                    {isPendingView && (
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAll}
                          title="Select all filtered"
                          className="h-3.5 w-3.5 accent-cobalt-primary"
                        />
                      </th>
                    )}
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
                    const rowBusy = busyId === s.id
                    return (
                      <tr
                        key={s.id}
                        onClick={() => navigate(`/review-queue/${s.id}`)}
                        className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                      >
                        {isPendingView && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(s.id)}
                              onChange={() => toggleRow(s.id)}
                              className="h-3.5 w-3.5 accent-cobalt-primary"
                            />
                          </td>
                        )}

                        <td className="px-4 py-3 text-sm text-text-secondary">
                          {s.customer ?? '—'}
                          {s.forwarder && (
                            <span className="mt-0.5 block text-[11px] text-text-muted">{s.forwarder}</span>
                          )}
                        </td>

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

                        <td className="px-4 py-3 text-sm text-text-secondary">{s.route ?? '—'}</td>

                        <td className="px-4 py-3">
                          <Badge variant="status" value={s.status} />
                        </td>

                        <td className="px-4 py-3">
                          {s.reviewReasons.length > 0 ? (
                            <ul className="list-disc space-y-0.5 pl-3.5 text-[11px] leading-snug text-text-secondary">
                              {humanizeReasons(s.reviewReasons).map(({ raw, text }) => (
                                <li key={raw} title={raw}>
                                  {text}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-xs text-text-muted">—</span>
                          )}
                          <span className="mt-1 block text-[10px] text-text-muted">
                            {formatRelativeTime(s.createdAt)}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {isPendingView ? (
                              <>
                                <button
                                  onClick={() => handleApprove(s.id)}
                                  disabled={anyMutating}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/15 px-2.5 py-1.5 text-xs font-medium text-status-success transition-colors hover:bg-status-success/25 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {rowBusy && confirmMutation.isPending ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <CheckCircle size={13} />
                                  )}
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleDismissOne(s.id)}
                                  disabled={anyMutating}
                                  title="Not a trackable shipment — remove from the queue (reversible)"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-2.5 py-1.5 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {rowBusy && dismissMutation.isPending ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <XCircle size={13} />
                                  )}
                                  Dismiss
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleRestore(s.id)}
                                disabled={anyMutating}
                                title="Return this item to the pending review queue"
                                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {rowBusy && restoreMutation.isPending ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={13} />
                                )}
                                Restore
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageShipments.length === 0 && (
                    <tr>
                      <td colSpan={colSpan} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <CheckCircle size={28} className="opacity-40" />
                          <span className="text-sm">
                            {isPendingView
                              ? category === 'all'
                                ? 'No shipments awaiting review.'
                                : `No pending items in “${CATEGORY_LABEL[category as ReasonCategory]}”.`
                              : 'Nothing has been dismissed.'}
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
    </div>
  )
}
