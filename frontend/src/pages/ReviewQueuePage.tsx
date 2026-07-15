import { Fragment, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle, Ship, Package, Loader2, XCircle, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react'
import {
  useReviewQueue,
  useReviewCounts,
  useConfirmShipment,
  useCorrectShipment,
  useDismissShipments,
  useRestoreShipment,
  useIdentifyShipment,
  useLinkShipment,
  isStaleConflict,
  type ReviewShipment,
  type ReviewQueueView,
} from '../hooks/use-review-queue'
import { useShipment } from '../hooks/use-shipments'
import { Badge } from '../components/ui/Badge'
import { ReviewCard } from '../components/review/ReviewCard'
import { Pagination, usePagination, PageSizeSelect } from '../components/ui/Pagination'
import { cn, formatRelativeTime } from '../lib/utils'
import {
  categoriesOf,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type ReasonCategory,
} from '../lib/review-reasons'

/** Inline expand: loads full criticReview for the conflict card (queue list only has compact). */
function ExpandedReviewPanel({
  row,
  readOnly,
  onApprove,
  onDismiss,
  onSaveAndApprove,
}: {
  row: ReviewShipment
  readOnly: boolean
  onApprove?: () => Promise<void>
  onDismiss?: () => Promise<void>
  onSaveAndApprove?: (payload: {
    fields: Record<string, unknown>
    note: string
    expectedUpdatedAt?: string
  }) => Promise<void>
}) {
  const { data, isLoading, isError } = useShipment(row.id)
  const identifyMutation = useIdentifyShipment()
  const linkMutation = useLinkShipment()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-text-muted">
        <Loader2 size={13} className="animate-spin" />
        Loading conflicts…
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="px-4 py-3 text-xs text-status-critical">
        Failed to load review details. Open the shipment for the full editor.
      </div>
    )
  }

  return (
    <div className="border-t border-border bg-surface-900/40 px-3 py-3">
      <ReviewCard
        shipment={data}
        criticReview={data.criticReview ?? null}
        compact={row.criticReviewCompact}
        emails={data.emails ?? []}
        fullShipmentPath={`/shipments/${row.id}`}
        defaultExpanded
        readOnly={readOnly}
        onApprove={onApprove}
        onDismiss={onDismiss}
        onSaveAndApprove={onSaveAndApprove}
        onIdentify={!readOnly ? async (field, value) => identifyMutation.mutateAsync({ shipmentId: row.id, field, value }) : undefined}
        onLink={!readOnly ? async (targetShipmentId) => { await linkMutation.mutateAsync({ shipmentId: row.id, targetShipmentId }) } : undefined}
      />
    </div>
  )
}

export default function ReviewQueuePage() {
  const [view, setView] = useState<ReviewQueueView>('active')
  const { data, isLoading, isError, refetch } = useReviewQueue(view)
  const { data: counts } = useReviewCounts()
  const confirmMutation = useConfirmShipment()
  const correctMutation = useCorrectShipment()
  const dismissMutation = useDismissShipments()
  const restoreMutation = useRestoreShipment()
  const navigate = useNavigate()
  const location = useLocation()

  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [category, setCategory] = useState<ReasonCategory | 'all'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkNote, setBulkNote] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(
    (location.state as { expandId?: string } | null)?.expandId ?? null,
  )
  const [staleBanner, setStaleBanner] = useState<string | null>(null)

  const shipments = useMemo(() => data?.shipments ?? [], [data?.shipments])

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
    setExpandedId(null)
    setStaleBanner(null)
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

  const handleStale = async (err: unknown) => {
    if (!isStaleConflict(err)) throw err
    setStaleBanner('This shipment was modified elsewhere — reloading the queue.')
    setExpandedId(null)
    await refetch()
  }

  const handleApprove = (s: ReviewShipment) => {
    setBusyId(s.id)
    setStaleBanner(null)
    confirmMutation.mutate(
      { shipmentId: s.id, expectedUpdatedAt: s.updatedAt },
      {
        onError: (err) => {
          void handleStale(err).catch(() => {
            setStaleBanner('Approve failed.')
          })
        },
        onSettled: () => setBusyId(null),
      },
    )
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

  const saveAndApproveFor = (s: ReviewShipment) => async (payload: {
    fields: Record<string, unknown>
    note: string
    expectedUpdatedAt?: string
  }) => {
    setStaleBanner(null)
    try {
      const fields = payload.fields
      const hasFields = Object.keys(fields).length > 0
      if (hasFields) {
        await correctMutation.mutateAsync({
          shipmentId: s.id,
          fields,
          reason: payload.note,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? s.updatedAt,
        })
      } else {
        await confirmMutation.mutateAsync({
          shipmentId: s.id,
          note: payload.note || undefined,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? s.updatedAt,
        })
      }
      setExpandedId(null)
    } catch (err) {
      await handleStale(err)
    }
  }

  const anyMutating = confirmMutation.isPending || correctMutation.isPending || dismissMutation.isPending || restoreMutation.isPending
  const isActiveView = view === 'active'
  const isRejectedView = view === 'rejected'
  // [checkbox?] + expand + band + customer + booking + route + status + action
  const colSpan = isActiveView ? 8 : 7

  const viewCopy: Record<ReviewQueueView, string> = {
    active:
      'Provisional shipments awaiting confirmation — resolve critic conflicts, then approve. Dismiss what is not a real shipment (portal echoes, no-move notices).',
    rejected: 'Dismissed items — ruled "not a trackable shipment". Restore anything dismissed by mistake.',
    approved: 'Recently confirmed legs that carried an AI critic review — read-only history.',
  }

  const emptyCopy = (): string => {
    if (isActiveView) {
      return category === 'all'
        ? 'No shipments awaiting review.'
        : `No active items in “${CATEGORY_LABEL[category as ReasonCategory]}”.`
    }
    if (isRejectedView) return 'Nothing has been dismissed.'
    return 'No approved critic-reviewed shipments yet.'
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-text-primary">Review Queue</h1>
          <p className="mt-0.5 text-xs text-text-muted">{viewCopy[view]}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View tabs — Active | Rejected | Approved */}
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(
              [
                { key: 'active' as const, label: `Active${counts ? ` (${counts.provisional})` : ''}` },
                { key: 'rejected' as const, label: `Rejected${counts ? ` (${counts.dismissed})` : ''}` },
                { key: 'approved' as const, label: 'Approved' },
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

      {staleBanner && (
        <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          {staleBanner}
        </div>
      )}

      {/* Reason-category filter chips (degrade gracefully when reasons empty) */}
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

      {/* Bulk-dismiss bar (active view, ≥1 selected) */}
      {isActiveView && selected.size > 0 && (
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
                    {isActiveView && (
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
                    <th className="w-10 px-2 py-3" aria-label="Expand" />
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Band</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Booking</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Route</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-text-muted">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-text-muted">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageShipments.map((s: ReviewShipment) => {
                    const rowBusy = busyId === s.id
                    const expanded = expandedId === s.id
                    const band = s.criticReviewCompact?.band
                    return (
                      <Fragment key={s.id}>
                        <tr
                          className="border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                        >
                          {isActiveView && (
                            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected.has(s.id)}
                                onChange={() => toggleRow(s.id)}
                                className="h-3.5 w-3.5 accent-cobalt-primary"
                              />
                            </td>
                          )}

                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() => setExpandedId(expanded ? null : s.id)}
                              aria-expanded={expanded}
                              aria-label={expanded ? 'Collapse row' : 'Expand row'}
                              className="inline-flex rounded-md p-1 text-text-muted hover:bg-surface-700 hover:text-text-primary"
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>

                          <td className="px-4 py-3">
                            {band ? (
                              <Badge variant="confidence" value={band} />
                            ) : (
                              <span className="text-xs text-text-muted">—</span>
                            )}
                          </td>

                          <td
                            className="cursor-pointer px-4 py-3 text-sm text-text-secondary"
                            onClick={() => setExpandedId(expanded ? null : s.id)}
                          >
                            {s.customer ?? '—'}
                            {s.forwarder && (
                              <span className="mt-0.5 block text-[11px] text-text-muted">{s.forwarder}</span>
                            )}
                            <span className="mt-1 block text-[10px] text-text-muted">
                              {formatRelativeTime(s.createdAt)}
                            </span>
                          </td>

                          <td
                            className="cursor-pointer px-4 py-3"
                            onClick={() => setExpandedId(expanded ? null : s.id)}
                          >
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

                          <td
                            className="cursor-pointer px-4 py-3 text-sm text-text-secondary"
                            onClick={() => setExpandedId(expanded ? null : s.id)}
                          >
                            {s.route ?? '—'}
                          </td>

                          <td
                            className="cursor-pointer px-4 py-3"
                            onClick={() => setExpandedId(expanded ? null : s.id)}
                          >
                            <Badge variant="status" value={s.status} />
                          </td>

                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              {isActiveView ? (
                                <>
                                  <button
                                    onClick={() => handleApprove(s)}
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
                              ) : isRejectedView ? (
                                <button
                                  onClick={() => handleRestore(s.id)}
                                  disabled={anyMutating}
                                  title="Return this item to the active review queue"
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {rowBusy && restoreMutation.isPending ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <RotateCcw size={13} />
                                  )}
                                  Restore
                                </button>
                              ) : (
                                <button
                                  onClick={() => navigate(`/shipments/${s.id}`)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary"
                                >
                                  Open
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-border bg-surface-900/20">
                            <td colSpan={colSpan} className="p-0">
                              <ExpandedReviewPanel
                                row={s}
                                readOnly={!isActiveView}
                                onApprove={
                                  isActiveView
                                    ? async () => {
                                        try {
                                          await confirmMutation.mutateAsync({
                                            shipmentId: s.id,
                                            expectedUpdatedAt: s.updatedAt,
                                          })
                                          setExpandedId(null)
                                        } catch (err) {
                                          await handleStale(err)
                                        }
                                      }
                                    : undefined
                                }
                                onDismiss={
                                  isActiveView
                                    ? async () => {
                                        await dismissMutation.mutateAsync({ shipmentIds: [s.id] })
                                        setExpandedId(null)
                                      }
                                    : undefined
                                }
                                onSaveAndApprove={isActiveView ? saveAndApproveFor(s) : undefined}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {pageShipments.length === 0 && (
                    <tr>
                      <td colSpan={colSpan} className="px-4 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-text-muted">
                          <CheckCircle size={28} className="opacity-40" />
                          <span className="text-sm">{emptyCopy()}</span>
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
