import { Fragment, useMemo, useReducer, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle, Ship, Package, Loader2, RotateCcw } from 'lucide-react'
import {
  useReviewQueue,
  useReviewCounts,
  useConfirmShipment,
  useCorrectShipment,
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
import { toast } from '../components/ui/Toast'
import { cn, formatRelativeTime } from '../lib/utils'
import {
  categoriesOf,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type ReasonCategory,
} from '../lib/review-reasons'
import { mapCriticFieldsToColumns } from '../lib/review-fields'



/** Filter / expand state that often transitions together (view switch clears category, page). */
type QueueUiState = {
  view: ReviewQueueView
  page: number
  category: ReasonCategory | 'all'
  expandedId: string | null
  staleBanner: string | null
}

type QueueUiAction =
  | { type: 'switchView'; view: ReviewQueueView }
  | { type: 'pickCategory'; category: ReasonCategory | 'all' }
  | { type: 'setPage'; page: number }
  | { type: 'setExpandedId'; id: string | null }
  | { type: 'setStaleBanner'; msg: string | null }

function queueUiReducer(state: QueueUiState, action: QueueUiAction): QueueUiState {
  switch (action.type) {
    case 'switchView':
      return {
        view: action.view,
        page: 1,
        category: 'all',
        expandedId: null,
        staleBanner: null,
      }
    case 'pickCategory':
      return { ...state, category: action.category, page: 1 }
    case 'setPage':
      return { ...state, page: action.page }
    case 'setExpandedId':
      return { ...state, expandedId: action.id }
    case 'setStaleBanner':
      return { ...state, staleBanner: action.msg }
    default:
      return state
  }
}

/** Inline expand: loads full criticReview for the conflict card (queue list only has compact). */
function ExpandedReviewPanel({
  row,
  readOnly,
  onApprove,
  onSaveAndApprove,
}: {
  row: ReviewShipment
  readOnly: boolean
  onApprove?: () => Promise<void>
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
    <div className="min-w-0 max-w-full border-t border-border bg-surface-900/40 px-3 py-3">
      <ReviewCard
        shipment={data}
        criticReview={data.criticReview ?? null}
        compact={row.criticReviewCompact}
        emails={data.emails ?? []}
        defaultExpanded
        embedded
        readOnly={readOnly}
        onApprove={onApprove}
        onSaveAndApprove={onSaveAndApprove}
        onIdentify={!readOnly ? async (field, value) => identifyMutation.mutateAsync({ shipmentId: row.id, field, value }) : undefined}
        onLink={!readOnly ? async (targetShipmentId) => { await linkMutation.mutateAsync({ shipmentId: row.id, targetShipmentId }) } : undefined}
      />
    </div>
  )
}

export default function ReviewQueuePage() {
  const location = useLocation()
  const [ui, dispatch] = useReducer(queueUiReducer, {
    view: 'active' as ReviewQueueView,
    page: 1,
    category: 'all' as ReasonCategory | 'all',
    expandedId: (location.state as { expandId?: string } | null)?.expandId ?? null,
    staleBanner: null as string | null,
  })
  const { view, page, category, expandedId, staleBanner } = ui
  const { data, isLoading, isError, refetch } = useReviewQueue(view)
  const { data: counts } = useReviewCounts()
  const confirmMutation = useConfirmShipment()
  const correctMutation = useCorrectShipment()
  const restoreMutation = useRestoreShipment()
  const navigate = useNavigate()

  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState<string | null>(null)

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

  const switchView = (v: ReviewQueueView) => dispatch({ type: 'switchView', view: v })
  const pickCategory = (c: ReasonCategory | 'all') => dispatch({ type: 'pickCategory', category: c })
  const setPage = (p: number) => dispatch({ type: 'setPage', page: p })
  const setExpandedId = (id: string | null) => dispatch({ type: 'setExpandedId', id })
  const setStaleBanner = (msg: string | null) => dispatch({ type: 'setStaleBanner', msg })

  const handleStale = async (err: unknown) => {
    if (!isStaleConflict(err)) throw err
    dispatch({ type: 'setStaleBanner', msg: 'This shipment was modified elsewhere — reloading the queue.' })
    dispatch({ type: 'setExpandedId', id: null })
    await refetch()
  }

  const handleRestore = (id: string) => {
    setBusyId(id)
    restoreMutation.mutate({ shipmentId: id }, { onSettled: () => setBusyId(null) })
  }

  const saveAndApproveFor = (s: ReviewShipment) => async (payload: {
    fields: Record<string, unknown>
    note: string
    expectedUpdatedAt?: string
  }) => {
    setStaleBanner(null)
    try {
      const fields = payload.fields
      // fields are already camelCase leg columns from ReviewCard; map is idempotent + renames any snake leftovers.
      const mapped = mapCriticFieldsToColumns(fields)
      const hasFields = Object.keys(fields).length > 0
      const hasMappable = Object.keys(mapped).length > 0
      if (hasFields && !hasMappable) {
        // Contested keys that do not map to leg columns — would have been a silent POST drop.
        toast('Those conflict fields cannot be saved here — open full shipment to edit.')
        return
      }
      if (hasMappable) {
        const res = await correctMutation.mutateAsync({
          shipmentId: s.id,
          fields: mapped,
          reason: payload.note,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? s.updatedAt,
        })
        const corrected = (res as { corrected?: string[] } | undefined)?.corrected
        const n = Array.isArray(corrected) ? corrected.length : Object.keys(mapped).length
        if (n === 0) {
          toast('Approved, but no fields were written — reload and try Approve again')
        } else {
          toast(`Saved ${n} field${n === 1 ? '' : 's'} and approved`)
        }
      } else {
        // #181: Approve with no contested-field deltas is confirm-only — operators often think
        // other edits stuck. Be explicit so this never looks like a silent no-op.
        toast(
          'Confirmed — no contested field changes to save. Open full shipment to edit other fields.',
        )
        await confirmMutation.mutateAsync({
          shipmentId: s.id,
          note: payload.note || undefined,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? s.updatedAt,
        })
      }
      setExpandedId(null)
    } catch (err) {
      try {
        await handleStale(err)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Save failed'
        toast(msg.replace(/^API error \d+:\s*/i, '') || 'Save failed — try again')
        throw e
      }
    }
  }

  const anyMutating = confirmMutation.isPending || correctMutation.isPending || restoreMutation.isPending
  const isActiveView = view === 'active'
  const isRejectedView = view === 'rejected'
  // Active = band + customer + booking + route + status (5).
  // Rejected/Approved = same + action (Restore / Open) (6).
  const colSpan = isActiveView ? 5 : 6

  const emptyCopy = (): string => {
    if (isActiveView) {
      return category === 'all'
        ? 'No shipments awaiting review.'
        : `No active items in “${CATEGORY_LABEL[category as ReasonCategory]}”.`
    }
    if (isRejectedView) return 'No rejected items.'
    return 'No approved critic-reviewed shipments yet.'
  }

  return (
    <div className="min-w-0 max-w-full space-y-5">
      {/* Header — title/help wrap left; tabs stay shrink-0 so large text does not shove them off-row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-text-primary">Review Queue</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                type="button"
                key={t.key}
                onClick={() => switchView(t.key)}
                className={cn(
                  'whitespace-nowrap px-3 py-1.5 text-xs font-medium transition-colors',
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
          type="button"
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
        {CATEGORY_ORDER.flatMap((c) => {
          const count = categoryCounts.get(c) ?? 0
          if (count <= 0) return []
          return [
            <button
              type="button"
              key={c}
              onClick={() => pickCategory(c)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                category === c
                  ? 'border-cobalt-primary bg-cobalt-primary/15 text-cobalt-primary-light'
                  : 'border-border bg-surface-800 text-text-secondary hover:text-text-primary',
              )}
            >
              {CATEGORY_LABEL[c]} ({count})
            </button>,
          ]
        })}
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
          <div className="max-w-full overflow-hidden rounded-xl border border-border bg-surface-800">
            <div className="overflow-x-auto">
              {/* table-fixed + col % keeps large-text / long names from blowing column widths */}
              <table className="w-full min-w-[40rem] table-fixed">
                <thead>
                  <tr className="border-b border-border bg-surface-900/50">
                    {/* "Band" is our word for the low/medium/high split, not the reader's. The value
                        IS criticReview.confidence.band, and Badge already calls the variant
                        'confidence' — only this header still leaked the jargon. The wire/domain name
                        stays `band` (the queue emits it); this is a label, not a rename. */}
                    <th className="w-[7.5rem] px-3 py-3 text-left text-xs font-medium text-text-muted sm:px-4">
                      AI Confidence
                    </th>
                    <th className="w-[28%] min-w-0 px-3 py-3 text-left text-xs font-medium text-text-muted sm:px-4">
                      Customer
                    </th>
                    <th className="w-[22%] min-w-0 px-3 py-3 text-left text-xs font-medium text-text-muted sm:px-4">
                      Booking
                    </th>
                    <th className="w-[16%] min-w-0 px-3 py-3 text-left text-xs font-medium text-text-muted sm:px-4">
                      Route
                    </th>
                    <th className="w-[8.5rem] px-3 py-3 text-left text-xs font-medium text-text-muted sm:px-4">
                      Status
                    </th>
                    {/* Active rows carry no Action column: the row expands on click and the panel
                        below owns Keep Existing / Approve. Rejected/Approved keep one — Restore and Open
                        have no equivalent inside the read-only panel. */}
                    {!isActiveView && (
                      <th className="w-[6.5rem] px-3 py-3 text-right text-xs font-medium text-text-muted sm:px-4">
                        Action
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pageShipments.map((s: ReviewShipment) => {
                    const rowBusy = busyId === s.id
                    const expanded = expandedId === s.id
                    const band = s.criticReviewCompact?.band
                    const bookingLabel = s.bookingNo ?? s.soNo ?? '—'
                    return (
                      <Fragment key={s.id}>
                        {/* The whole row is the expand control — a dedicated chevron column was a
                            second way to do what clicking already did. Keyboard parity via
                            role/tabIndex/Enter, which the removed <button> used to provide. */}
                        <tr
                          role="button"
                          tabIndex={0}
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(expanded ? null : s.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setExpandedId(expanded ? null : s.id)
                            }
                          }}
                          className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-surface-700/50"
                        >
                          <td className="px-3 py-3 sm:px-4">
                            {band ? (
                              <Badge variant="confidence" value={band} />
                            ) : (
                              <span className="text-xs text-text-muted">—</span>
                            )}
                          </td>

                          <td className="min-w-0 max-w-0 px-3 py-3 text-sm text-text-secondary sm:px-4">
                            <span className="block truncate" title={s.customer ?? undefined}>
                              {s.customer ?? '—'}
                            </span>
                            {s.forwarder && (
                              <span className="mt-0.5 block truncate text-[11px] text-text-muted" title={s.forwarder}>
                                {s.forwarder}
                              </span>
                            )}
                            <span className="mt-1 block text-[10px] text-text-muted">
                              {formatRelativeTime(s.createdAt)}
                            </span>
                          </td>

                          <td className="min-w-0 max-w-0 px-3 py-3 sm:px-4">
                            <span
                              className="inline-flex max-w-full items-center gap-1.5 font-mono text-sm font-medium text-cobalt-primary-light"
                              title={bookingLabel !== '—' ? bookingLabel : undefined}
                            >
                              <Ship size={13} className="shrink-0 text-text-muted" />
                              <span className="min-w-0 truncate">{bookingLabel}</span>
                            </span>
                            {s.poCount > 0 && (
                              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-text-muted">
                                <Package size={10} className="shrink-0" />
                                {s.poCount} PO{s.poCount !== 1 ? 's' : ''}
                              </span>
                            )}
                          </td>

                          <td className="min-w-0 max-w-0 px-3 py-3 text-sm text-text-secondary sm:px-4">
                            <span className="block truncate" title={s.route ?? undefined}>
                              {s.route ?? '—'}
                            </span>
                          </td>

                          <td className="px-3 py-3 sm:px-4">
                            <Badge variant="status" value={s.status} />
                          </td>

                          {!isActiveView && (
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              {isRejectedView ? (
                                <button
                                  type="button"
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
                                  type="button"
                                  onClick={() => navigate(`/shipments/${s.id}`)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-600 hover:text-text-primary"
                                >
                                  Open
                                </button>
                              )}
                            </div>
                          </td>
                          )}
                        </tr>
                        {expanded && (
                          <tr className="border-b border-border bg-surface-900/20">
                            <td colSpan={colSpan} className="max-w-0 p-0">
                              <div className="min-w-0 max-w-full overflow-x-auto">
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
                                onSaveAndApprove={isActiveView ? saveAndApproveFor(s) : undefined}
                              />
                              </div>
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
