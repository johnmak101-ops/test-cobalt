import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/Badge'
import { cn, formatRelativeTime, formatShipmentId } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'
import { isHiddenOpsField } from '../../lib/review-reasons'
import { reviewFieldLabel } from '../../lib/review-fields'
import {
  buildNeedsAttention,
  portsLinkedFromRoute,
  type NeedsAttentionGroupId,
} from '../review/needs-attention'
import { DESK_ROW_BODY, DESK_ROW_HEAD, DESK_ROW_META, DESK_ROW_TIME } from './desk-row'
import type { ReviewShipment } from '../../hooks/use-review-queue'

/** How many rows before the dashboard defers to the Review Queue page. */
const MAX_ROWS = 3

/** Fields named on one row before the line stops reading as a sentence. */
const MAX_NAMED_FIELDS = 3

/** What the row needs to state its own reason — a queue list row carries all of it. */
export type SummarizableRow = Pick<
  ReviewShipment,
  'reviewReasons' | 'openDecisions' | 'route' | 'poCount'
>

/**
 * The fields the conflict table will show as rows, named the way that table names them.
 *
 * The count comes from the BACKEND (openDecisions.openFields) — conflicts minus the ones the commit
 * already settled. The queue gate's own wording cannot be used here: it counts the conflicts as they
 * stood before the committer wrote anything, which is how this card came to read "9 field(s) received
 * different values" over a desk that had two rows left.
 */
function conflictLine(openFields: string[]): string | null {
  if (openFields.length === 0) return null
  const labels = openFields.map((f) => reviewFieldLabel(f, f.replace(/_/g, ' ')))
  const shown = labels.slice(0, MAX_NAMED_FIELDS).join(', ')
  const more = labels.length > MAX_NAMED_FIELDS ? ` +${labels.length - MAX_NAMED_FIELDS} more` : ''
  return `Emails disagree about: ${shown}${more} — open to compare`
}

/** Confidence band → the same left-edge weight AlertCard gives severity (low is the loud one). */
const bandBorder: Record<string, string> = {
  low: 'border-l-status-critical',
  medium: 'border-l-status-warning',
  high: 'border-l-status-success',
}

/**
 * Why this leg is on the desk, in one line — the review row's answer to an alert's `message`.
 *
 * This was `humanizeReason(reviewReasons[0])`: the one place in the app that rendered a review reason
 * without the review desk's pipeline. Three things followed, all on screen together on 2026-07-30:
 *
 * 1. RAW AUDIT TEXT. `humanizeReason` falls through to the original string when no translation matches,
 *    so leg 202601556A led with `identity-dispose: demoted 进仓-labelled 'GZL26258522' out of b…`,
 *    clamped mid-word. The desk classifies that same string as FYI and never shows it.
 * 2. PRE-COMMIT COUNTS. "9 field(s) received different values" is the queue gate's `9 field conflict(s)`
 *    passed straight through, while the card strips settled rows and drops conflict prose entirely once
 *    the table owns the comparison.
 * 3. ARBITRARY PICK. `reasons[0]` is array order, not priority, and nothing dropped a port or party miss
 *    that had since resolved.
 *
 * So it runs the same builder the card runs, keeps only `decision` lines, and picks between them in the
 * card's headline order (desk-question.ts QUESTION_PRIORITY): is it freight, is it the right shipment,
 * then the field grid, then everything else. Returns null when the leg's only lines are FYI — the row
 * then says it is held for review, which is true, instead of quoting the pipeline's notebook.
 */
export function primaryReason(row: SummarizableRow): string | null {
  const openFields = (row.openDecisions?.openFields ?? []).filter((f) => !isHiddenOpsField(f))
  const settled = row.openDecisions?.settledFields ?? []
  const items = buildNeedsAttention({
    reviewReasons: row.reviewReasons,
    /**
     * What the conflict TABLE speaks for: rows still open plus the rows it resolved (ReviewCard's
     * tableOwnedCount). Passing it here is what suppresses the gate's conflict prose on this row for
     * exactly the legs where the card suppresses it too.
     */
    conflictsCount: openFields.length + settled.length,
    hasPo: (row.poCount ?? 0) > 0,
    portsLinked: portsLinkedFromRoute(row.route),
    partiesLinked: Object.fromEntries(
      (row.openDecisions?.resolvedParties ?? []).map((p) => [p.slot, p.name]),
    ),
  }).filter((i) => i.desk === 'decision')

  // buildNeedsAttention already sorted by severity, so the first hit in a group is its loudest line.
  const inGroup = (g: NeedsAttentionGroupId): string | null =>
    items.find((i) => i.groupId === g)?.text ?? null

  return (
    inGroup('real_shipment') ??
    inGroup('which_shipment') ??
    conflictLine(openFields) ??
    inGroup('fields_disagree') ??
    inGroup('master_miss') ??
    inGroup('incomplete_data') ??
    inGroup('other')
  )
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
            const reason = primaryReason(s)
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
