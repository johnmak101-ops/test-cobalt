import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, ChevronDown, ChevronRight, ExternalLink, Loader2, Mail, NotebookPen, Save, XCircle } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { ConflictRow, splitCandidates } from './ConflictRow'
import {
  aiCommentLine,
  type CriticConflict,
  type CriticReview,
  type CriticReviewCompact,
} from '../../lib/critic-review'
import type { ReviewShipment } from '../../hooks/use-review-queue'
import type { ShipmentDetail } from '../../hooks/use-shipments'
import { cn } from '../../lib/utils'
import { humanizeReasons } from '../../lib/review-reasons'

export interface ReviewCardSavePayload {
  fields: Record<string, unknown>
  note: string
  expectedUpdatedAt?: string
}

/** One source email of the leg — enough to open the reading-pane pop-up. */
export type ReviewEmail = {
  id: string
  subject: string
  sender: string
  receivedAt?: string | null
  emailType?: string | null
}

export interface ReviewCardProps {
  shipment: ReviewShipment | ShipmentDetail
  criticReview: CriticReview | null
  /** Queue-safe projection for AI comment when full payload is absent. */
  compact?: CriticReviewCompact | null
  /** Source emails behind this leg — rendered as chips that open the email pop-up window.
   *  Resolving a conflict means reading what the email actually said, so keep it one click away. */
  emails?: ReviewEmail[]
  /** Route to the full shipment editor — rendered as an "Open full shipment" link when set. */
  fullShipmentPath?: string
  defaultExpanded?: boolean
  /** Resolved history — hide inputs and primary actions. */
  readOnly?: boolean
  onSaveAndApprove?: (payload: ReviewCardSavePayload) => Promise<void>
  onApprove?: () => Promise<void>
  onDismiss?: () => Promise<void>
}

function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value) {
    const n = (value as { name?: unknown }).name
    return typeof n === 'string' ? n : null
  }
  return null
}

function identityOf(s: ReviewShipment | ShipmentDetail) {
  const asQueue = s as ReviewShipment
  const asDetail = s as ShipmentDetail
  return {
    customer: nameOf(asQueue.customer ?? asDetail.customer),
    forwarder: nameOf(asQueue.forwarder ?? asDetail.forwarder),
    booking: s.bookingNo ?? asQueue.soNo ?? asDetail.soNumber ?? null,
    route: s.route,
    status: s.status,
    updatedAt: s.updatedAt,
  }
}

function compactFromReview(cr: CriticReview): CriticReviewCompact {
  // Defensive: ShipTrack trusts-and-stores the payload loosely, so a partial/malformed
  // criticReview must not throw when the card expands.
  return {
    band: cr.confidence?.band ?? 'low',
    summary: cr.summary ?? '',
    topConflictType:
      cr.riskFlags?.[0]?.message
      ?? cr.reasons?.[0]
      ?? cr.summary
      ?? 'Needs review',
  }
}

function initialResolutions(conflicts: CriticConflict[]): Record<string, string> {
  const out: Record<string, string> = {}
  // No pre-filled recommendation — a queued conflict has no safe auto-pick; the operator chooses.
  for (const c of conflicts) out[c.field] = ''
  return out
}

function existingValue(c: CriticConflict): string {
  return splitCandidates(c).existing?.value ?? ''
}

/**
 * Collapsible critic review card — band + identity when collapsed; AI comment,
 * conflict-only table, notes, and Save&Approve when expanded.
 */
/** Open the source email in the chrome-less reading-pane pop-up (same window target + geometry as
 *  the shipment history timeline, so a reviewer can read the original side-by-side). */
function openEmailWindow(e: ReviewEmail): void {
  window.open(
    `/email/${e.id}?type=${encodeURIComponent(e.emailType ?? '')}`,
    `email_${e.id}`,
    'popup,width=880,height=940,resizable=yes,scrollbars=yes',
  )
}

export function ReviewCard({
  shipment,
  criticReview,
  compact = null,
  emails = [],
  fullShipmentPath,
  defaultExpanded = false,
  readOnly = false,
  onSaveAndApprove,
  onApprove,
  onDismiss,
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const conflicts = useMemo(
    () => criticReview?.conflicts ?? [],
    [criticReview],
  )
  // WHY this leg is queued — risk flags from the critic payload; legacy rows fall back to the
  // gate's raw reviewReasons. Rendered expanded-only (collapsed stays identity-only by design).
  const whyReview = useMemo(() => {
    const flags = (criticReview?.riskFlags ?? [])
      .filter((f) => f?.message)
      .map((f, i) => ({ key: `${f.code}-${i}`, severity: f.severity, text: f.message }))
    if (flags.length > 0) return flags
    const reasons = (shipment as { reviewReasons?: string[] | null }).reviewReasons ?? []
    return humanizeReasons(reasons).map(({ raw, text }) => ({
      key: raw,
      severity: 'medium' as const,
      text,
    }))
  }, [criticReview, shipment])
  const [resolutions, setResolutions] = useState<Record<string, string>>(() =>
    initialResolutions(conflicts),
  )

  // Re-seed when the conflict set identity changes (new payload / leg).
  const conflictKey = useMemo(
    () => conflicts.map((c) => c.field).join('|'),
    [conflicts],
  )
  const [seededKey, setSeededKey] = useState(conflictKey)
  if (seededKey !== conflictKey) {
    setSeededKey(conflictKey)
    setResolutions(initialResolutions(conflicts))
  }

  const id = identityOf(shipment)
  const band = compact?.band ?? criticReview?.confidence?.band ?? null
  const lineCompact = compact ?? (criticReview ? compactFromReview(criticReview) : null)

  const fieldsToApply = useMemo(() => {
    const fields: Record<string, unknown> = {}
    for (const c of conflicts) {
      const v = (resolutions[c.field] ?? '').trim()
      const existing = existingValue(c)
      // Apply when operator set a value that differs from what's already stored.
      if (v !== '' && v !== existing) fields[c.field] = v
    }
    return fields
  }, [conflicts, resolutions])

  // A note is mandatory whenever a value is actually changed (differs from the STORED value) — not
  // merely when it differs from a suggestion. Matches the detail page's correctBlocked rule, and
  // prevents a silent human-wins field lock with no reason.
  const dirty = Object.keys(fieldsToApply).length > 0
  const noteRequired = dirty && !note.trim()
  const canSave = !readOnly && !noteRequired && !busy && (onSaveAndApprove || onApprove)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const handleSaveAndApprove = () => {
    if (noteRequired || busy) return
    const hasFieldEdits = Object.keys(fieldsToApply).length > 0
    if (hasFieldEdits && onSaveAndApprove) {
      void run(() =>
        onSaveAndApprove({
          fields: fieldsToApply,
          note: note.trim(),
          expectedUpdatedAt: id.updatedAt,
        }),
      )
      return
    }
    if (onApprove) {
      void run(() => onApprove())
      return
    }
    if (onSaveAndApprove) {
      void run(() =>
        onSaveAndApprove({
          fields: fieldsToApply,
          note: note.trim(),
          expectedUpdatedAt: id.updatedAt,
        }),
      )
    }
  }

  const handleApproveCollapsed = () => {
    if (!onApprove || busy || readOnly) return
    void run(() => onApprove())
  }

  const handleDismiss = () => {
    if (!onDismiss || busy || readOnly) return
    void run(() => onDismiss())
  }

  return (
    <div className="rounded-xl border border-border bg-surface-800">
      {/* Collapsed identity row (§2.1) */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-text-muted hover:bg-surface-700 hover:text-text-primary"
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        {band ? (
          <Badge variant="confidence" value={band} />
        ) : (
          <span className="inline-block w-10" aria-hidden />
        )}

        <div className="min-w-0 flex-1 text-sm text-text-secondary">
          <span className="text-text-primary">{id.customer ?? '—'}</span>
          {id.forwarder && (
            <span className="text-text-muted"> · {id.forwarder}</span>
          )}
          <span className="text-text-muted"> · </span>
          <span className="font-mono text-cobalt-primary-light">{id.booking ?? '—'}</span>
          {id.route && (
            <>
              <span className="text-text-muted"> · </span>
              <span>{id.route}</span>
            </>
          )}
          {id.status && (
            <span className="ml-2 inline-flex align-middle">
              <Badge variant="status" value={id.status} />
            </span>
          )}
        </div>

        {!readOnly && !expanded && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {onApprove && (
              <button
                type="button"
                onClick={handleApproveCollapsed}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-status-success/15 px-2.5 py-1.5 text-xs font-medium text-status-success transition-colors hover:bg-status-success/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
                Approve
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={handleDismiss}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-2.5 py-1.5 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expanded: AI comment + conflicts-only + notes + Save&Approve (§2.2) */}
      {expanded && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3">
          {(lineCompact || fullShipmentPath) && (
            <div className="flex items-start justify-between gap-2">
              {lineCompact ? (
                <p className="text-sm font-medium text-text-primary" data-testid="ai-comment-line">
                  {aiCommentLine(lineCompact)}
                </p>
              ) : (
                <span />
              )}
              {fullShipmentPath && (
                <Link
                  to={fullShipmentPath}
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-cobalt-primary-light hover:underline"
                >
                  Open full shipment
                  <ExternalLink size={10} />
                </Link>
              )}
            </div>
          )}

          {/* Source emails — resolving a conflict means reading what the email actually said. */}
          {emails.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="source-emails">
              <span className="text-[11px] font-medium text-text-muted">Source emails:</span>
              {emails.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEmailWindow(e)}
                  title={`${e.subject || '(no subject)'} — ${e.sender}`}
                  aria-label={`Open source email: ${e.subject || '(no subject)'}`}
                  className="inline-flex max-w-[18rem] items-center gap-1 rounded-full border border-border bg-surface-900 px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-cobalt-primary hover:text-cobalt-primary-light"
                >
                  <Mail size={10} className="shrink-0 text-text-muted" />
                  <span className="truncate">{e.emailType || e.subject || '(no subject)'}</span>
                  <ExternalLink size={9} className="shrink-0 opacity-60" />
                </button>
              ))}
            </div>
          )}

          {whyReview.length > 0 && (
            <div className="rounded-lg bg-surface-900 px-3 py-2" data-testid="why-review">
              <p className="text-[11px] font-medium text-text-muted">Why review?</p>
              <ul className="mt-1 space-y-1">
                {whyReview.map((r) => (
                  <li key={r.key} className="flex items-start gap-1.5 text-xs text-text-secondary">
                    <span
                      className={cn(
                        'mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        r.severity === 'high'
                          ? 'bg-status-critical'
                          : r.severity === 'medium'
                            ? 'bg-status-warning'
                            : 'bg-surface-600',
                      )}
                    />
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[36rem]">
                <thead>
                  <tr className="border-b border-border bg-surface-900/50 text-left text-[11px] font-medium text-text-muted">
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Existing</th>
                    <th className="px-3 py-2">Proposed</th>
                    <th className="px-3 py-2">Resolution</th>
                  </tr>
                </thead>
                <tbody>
                  {conflicts.map((c) => (
                    <ConflictRow
                      key={c.field}
                      conflict={c}
                      value={resolutions[c.field] ?? ''}
                      onChange={(v) => setResolutions((prev) => ({ ...prev, [c.field]: v }))}
                      readOnly={readOnly}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!readOnly && (
            <>
              <div>
                <label
                  htmlFor={`review-note-${shipment.id}`}
                  className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-primary"
                >
                  <NotebookPen size={12} className="text-text-muted" />
                  Note
                  {dirty && (
                    <span className="font-normal text-status-warning">· required when you change a value</span>
                  )}
                </label>
                <textarea
                  id={`review-note-${shipment.id}`}
                  aria-label="Note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Why this resolution? (required when you change a value)"
                  className={cn(
                    'w-full rounded-lg border bg-surface-900 p-2.5 text-sm text-text-primary placeholder:text-text-muted',
                    noteRequired ? 'border-status-warning/60' : 'border-border',
                  )}
                />
                {noteRequired && (
                  <p className="mt-1 text-xs text-status-warning">
                    Add a note before Save & Approve — you changed a value.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {onDismiss && (
                  <button
                    type="button"
                    onClick={handleDismiss}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-status-critical/15 px-3 py-1.5 text-xs font-medium text-status-critical transition-colors hover:bg-status-critical/25 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                    Dismiss
                  </button>
                )}
                {(onSaveAndApprove || onApprove) && (
                  <button
                    type="button"
                    onClick={handleSaveAndApprove}
                    disabled={!canSave}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Save changes & Approve
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
