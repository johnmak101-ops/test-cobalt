import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { cn, formatRelativeTime, formatShipmentId } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'
import { humanizeReason, isSilentOpsReason } from '../../lib/review-reasons'
import { DESK_ROW_BODY, DESK_ROW_HEAD, DESK_ROW_META, DESK_ROW_TIME } from './desk-row'
import type { ReviewShipment } from '../../hooks/use-review-queue'

/** How many rows before the dashboard defers to the Review Queue page. */
const MAX_ROWS = 3

/** Confidence band → the same left-edge weight AlertCard gives severity (low is the loud one). */
const bandBorder: Record<string, string> = {
  low: 'border-l-status-critical',
  medium: 'border-l-status-warning',
  high: 'border-l-status-success',
}

/**
 * Why this leg is on the desk, in one line — the review row's answer to an alert's `message`.
 *
 * Ops-internal chatter is skipped (isSilentOpsReason): those lines exist for the pipeline's own
 * audit trail, not for an operator, and leading a card with one says nothing about what to do.
 */
export function primaryReason(reasons: string[] | undefined): string | null {
  const first = (reasons ?? []).map((r) => String(r ?? '').trim()).find((r) => r && !isSilentOpsReason(r))
  return first ? humanizeReason(first) : null
}

/**
 * The top of the review desk, on the dashboard.
 *
 * Built to MIRROR AlertCard, because the two sit side by side and were reading as two different
 * products: bordered cards with a severity edge and a full sentence on the left, bare list rows with
 * a right-aligned badge on the right. Same shell, same left-edge weight (confidence band standing in
 * for severity), same derived Shipment ID via formatShipmentId, same relative timestamp — so a row
 * here and a row there differ only in what they say, not in how they are built.
 *
 * The reason line is the point of the mirror, not decoration. An alert states why it fired; a review
 * row that shows only an identifier makes the operator open it to find out why it is queued at all.
 *
 * Capped at three, with a footer naming what is not shown: the heading count must never read as
 * "that's all", and a list that grows with its content would push this card taller than the alerts
 * beside it and the row would stop lining up.
 */
export function ReviewQueuePanel({ shipments }: { shipments: ReviewShipment[] }) {
  const navigate = useNavigate()
  const shown = shipments.slice(0, MAX_ROWS)
  const rest = shipments.length - shown.length

  return (
    <div
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface-800 p-4"
      data-testid="dashboard-review-queue"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold text-text-primary">
          Review Queue
          {shipments.length > 0 && (
            <span className="ml-2 text-xs font-normal text-text-muted">· {shipments.length}</span>
          )}
        </h2>
        <button
          type="button"
          onClick={() => navigate('/review-queue')}
          className="shrink-0 text-xs font-medium text-cobalt-primary-light hover:underline"
        >
          {rest > 0 ? `View All (${shipments.length})` : 'View All'}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-text-muted">Nothing waiting for review.</p>
      ) : (
        <div className="space-y-2">
          {shown.map((s) => {
            const band = s.criticReviewCompact?.band ?? null
            const label = formatShipmentId(s.id, s.firstEmailAt ?? s.createdAt)
            const identifier = (s.bookingNo ?? '').trim() || (s.soNo ?? '').trim() || (s.hblAwbFcrNo ?? '').trim()
            const who = [s.customer, s.forwarder, s.route].filter(Boolean).join(' · ')
            const reason = primaryReason(s.reviewReasons)
            return (
              <div
                key={s.id}
                {...interactiveProps(() => navigate(`/review-queue/${s.id}`))}
                className={cn(
                  'cursor-pointer rounded-lg border border-border border-l-4 bg-surface-800 p-3 transition-colors hover:bg-surface-700',
                  band ? bandBorder[band] : 'border-l-border',
                )}
              >
                {/* Same reserved metrics as the compact AlertCard beside it (desk-row.ts), so row N
                    of this column lines up with row N of that one however long either text runs. */}
                <div className={DESK_ROW_HEAD}>
                  {band && <Badge variant="confidence" value={band} />}
                  <span className="min-w-0 truncate font-mono text-sm font-medium text-text-primary">
                    {identifier ? `${label} | ${identifier}` : label}
                  </span>
                </div>
                <p className={DESK_ROW_META}>{who}</p>
                <p className={cn(DESK_ROW_BODY, 'text-text-secondary')}>
                  {reason ?? 'Held for review — open to see what needs deciding.'}
                </p>
                <p className={DESK_ROW_TIME}>{formatRelativeTime(s.firstEmailAt ?? s.createdAt)}</p>
              </div>
            )
          })}
        </div>
      )}

      {rest > 0 && (
        <p className="mt-auto border-t border-border pt-2.5 text-xs text-text-muted">
          {rest} more waiting for review
        </p>
      )}
    </div>
  )
}
