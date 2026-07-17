import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, ChevronDown, ChevronRight, ExternalLink, Loader2, Mail, NotebookPen, Pencil, Save, XCircle } from 'lucide-react'
import { Badge } from '../ui/Badge'
import {
  ConflictRow,
  changesStoredValue,
  existingValueOf,
  proposedValueOf,
} from './ConflictRow'
import { fieldUnit, groupConflictFields, mapCriticFieldToColumn } from '../../lib/review-fields'
import {
  aiCommentLine,
  type CriticConflict,
  type CriticReview,
  type CriticReviewCompact,
} from '../../lib/critic-review'
import { CandidateLegsPanel } from './CandidateLegsPanel'
import type { ReviewShipment } from '../../hooks/use-review-queue'
import type { ShipmentDetail } from '../../hooks/use-shipments'
import { cn, formatDateTime } from '../../lib/utils'
import { buildNeedsAttentionGroups } from './needs-attention'

/**
 * ONE geometry for every button in the card's action bar; variants change COLOUR only, never size,
 * padding or radius. The bar drifted precisely because each button hand-rolled its own class list.
 * Weight reads as intent: solid = the committing action, tinted = everything else.
 */
// The base sets `border` (WIDTH only) — so EVERY variant below MUST name a border colour. Tailwind
// v4 defaults border-color to currentColor, so an omission renders a hard full-strength outline
// rather than nothing (the bug Badge.emailTypeStyles had). Tints follow the Badge convention:
// a /30 border over a /15 fill; the solid primary borders in its own colour so all three match height.
const ACTION_BTN =
  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const ACTION_VARIANT = {
  primary:
    'border-cobalt-primary bg-cobalt-primary text-white hover:border-cobalt-primary-light hover:bg-cobalt-primary-light',
  secondary: 'border-cobalt-primary/30 bg-cobalt-primary/15 text-cobalt-primary-light hover:bg-cobalt-primary/25',
  danger: 'border-status-critical/30 bg-status-critical/15 text-status-critical hover:bg-status-critical/25',
  success: 'border-status-success/30 bg-status-success/15 text-status-success hover:bg-status-success/25',
} as const

/** What the operator decided about ONE contested field — the unit the learner trains on (ADR-0002). */
export interface ReviewCorrection {
  field: string
  /** What ShipTrack already stored ('' when the field was empty). */
  existing: string
  /** What the agent proposed ('' when it offered nothing). */
  aiProposed: string
  /** What the operator committed. Equal to aiProposed = confirmation; different = correction. */
  humanFinal: string
}

export interface ReviewCardSavePayload {
  fields: Record<string, unknown>
  note: string
  /** Per-field decision trail. Additive: consumers that ignore it keep working. */
  corrections?: ReviewCorrection[]
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

/** Result of typing a strong ID on a zero-identity leg (POST /review/:id/identify). */
export type IdentifyResult =
  | { outcome: 'set'; field: string; value: string }
  | { outcome: 'candidate'; candidate: { shipmentId: string; jobNo: string; matchedValue: string } }
  | { outcome: 'ambiguous'; count: number }

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
  /**
   * Rendered inside a queue table row that ALREADY states band/customer/booking/route/status and
   * owns the expand chevron. Drops this card's own identity header (it read as the same leg listed
   * twice) and its frame, so the detail reads as one continuous panel with the row above it.
   */
  embedded?: boolean
  /** Resolved history — hide inputs and primary actions. */
  readOnly?: boolean
  onSaveAndApprove?: (payload: ReviewCardSavePayload) => Promise<void>
  onApprove?: () => Promise<void>
  onDismiss?: () => Promise<void>
  /** Zero-identity flow: type booking/SO/B/L and detect if it already exists elsewhere. */
  onIdentify?: (field: string, value: string) => Promise<IdentifyResult>
  /** Zero-identity flow: fold this provisional into an existing shipment that carries the typed key. */
  onLink?: (targetShipmentId: string) => Promise<void>
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
  // Seeded with the agent's proposal: the table reads as a diff, and approving accepts it. A queued
  // conflict still has no safe AUTO-pick, so the primary button NAMES the number of stored values it
  // would overwrite ("Approve 3 changes") — pre-filled must not read as pre-approved.
  for (const c of conflicts) out[c.field] = proposedValueOf(c)
  return out
}

function existingValue(c: CriticConflict): string {
  return existingValueOf(c)
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
  embedded = false,
  readOnly = false,
  onSaveAndApprove,
  onApprove,
  onDismiss,
  onIdentify,
  onLink,
}: ReviewCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const isWeakIdentity = (criticReview?.riskFlags ?? []).some((f) => f.code === 'WEAK_IDENTITY')
  const isAmbiguousMatch = (criticReview?.riskFlags ?? []).some((f) => f.code === 'AMBIGUOUS_MATCH')
  // #129: closed-set candidates from matcher (preferred over free-type Identify when present)
  const matchAmbiguity = criticReview?.matchAmbiguity
  const hasCandidateLegs = (matchAmbiguity?.candidates?.length ?? 0) >= 2
  // Identify/link: weak-identity fold OR ambiguous-match (which real shipment?) — #146
  // Still show Identify when ambiguous but no candidate payload (legacy legs) or as fallback under panel
  const showIdentify = !readOnly && !!onIdentify && (isWeakIdentity || isAmbiguousMatch)
  const [identField, setIdentField] = useState<'booking_no' | 'so_no' | 'hbl_awb_fcr_no'>('booking_no')
  const [identValue, setIdentValue] = useState('')
  const [identResult, setIdentResult] = useState<IdentifyResult | null>(null)
  const [identBusy, setIdentBusy] = useState(false)

  const conflicts = useMemo(
    () => criticReview?.conflicts ?? [],
    [criticReview],
  )
  /** Newest first: "which statement is the latest?" is the question a reviewer actually has, and a
   *  date they must compare by hand only half-answers it. Undated mail sorts last, not first. */
  const sortedEmails = useMemo(
    () =>
      [...emails].sort(
        (a, b) => (b.receivedAt ? Date.parse(b.receivedAt) : 0) - (a.receivedAt ? Date.parse(a.receivedAt) : 0),
      ),
    [emails],
  )
  // Needs attention — layman groups (design 2026-07-17). Field diffs live in the table when present.
  const needsAttentionGroups = useMemo(
    () =>
      buildNeedsAttentionGroups({
        riskFlags: criticReview?.riskFlags,
        reviewReasons: (shipment as { reviewReasons?: string[] | null }).reviewReasons,
        conflictsCount: conflicts.length,
      }),
    [criticReview, shipment, conflicts.length],
  )
  const [resolutions, setResolutions] = useState<Record<string, string>>(() =>
    initialResolutions(conflicts),
  )
  /** Card-level edit mode. The table reads as a clean diff until the operator asks to change it. */
  const [editing, setEditing] = useState(false)

  // Re-seed when the conflict set identity changes (new payload / leg).
  const conflictKey = useMemo(
    () => conflicts.map((c) => c.field).join('|'),
    [conflicts],
  )
  const [seededKey, setSeededKey] = useState(conflictKey)
  if (seededKey !== conflictKey) {
    setSeededKey(conflictKey)
    setResolutions(initialResolutions(conflicts))
    setEditing(false)
  }

  const setResolution = (field: string, v: string) => {
    setResolutions((prev) => ({ ...prev, [field]: v }))
  }

  /**
   * Units for a contested row. A bare number is unreadable ('14' — of what?), so the value carries
   * its unit exactly as Order Details does.
   *
   * Weight/volume are invariant (KGS/CBM) → both sides share one. `qty` is the dangerous case: its
   * unit is the leg's own UOM, and when the email ALSO contests qty_unit the two sides are counting
   * different things (the 260-cartons vs 13516-pieces family). Stamping the STORED unit onto the
   * agent's number would then assert something no one said — so the proposal shows no unit and the
   * contested UOM row speaks for itself.
   */
  const unitsFor = (c: CriticConflict): { existing: string | null; proposed: string | null } => {
    const column = mapCriticFieldToColumn(c.field)
    const fixed = column ? fieldUnit(column) : null
    if (fixed) return { existing: fixed, proposed: fixed }
    if (column !== 'qty') return { existing: null, proposed: null }
    const uom = (shipment as Partial<ShipmentDetail>).quantityUnit ?? null
    const uomContested = conflicts.some((x) => mapCriticFieldToColumn(x.field) === 'qtyUnit')
    return { existing: uom, proposed: uomContested ? null : uom }
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

  /**
   * The learning signal (ADR-0002). `aiProposed` is what the agent suggested, `humanFinal` is what
   * the operator committed — equal values are a confirmation, differing ones a correction. Dropping
   * aiProposed would leave the learner knowing only that a human typed something, not what it got
   * wrong, so it is carried even though the cell renders once.
   */
  const corrections = useMemo(
    () =>
      conflicts
        .filter((c) => c.field in fieldsToApply)
        .map((c) => ({
          field: c.field,
          existing: existingValue(c),
          aiProposed: proposedValueOf(c),
          humanFinal: String(fieldsToApply[c.field] ?? ''),
        })),
    [conflicts, fieldsToApply],
  )

  // A note is mandatory when the operator OVERRIDES the agent — a value that is neither what is
  // stored nor what was proposed is a human judgement, and the note is the only record of why (and
  // the training signal). Accepting the agent's proposal needs no note: the confirm click is the
  // record. Requiring one there would demand a note on every single approval.
  const overrides = useMemo(
    () =>
      conflicts.filter((c) => {
        const v = (resolutions[c.field] ?? '').trim()
        return v !== '' && v !== existingValue(c) && v !== proposedValueOf(c)
      }),
    [conflicts, resolutions],
  )
  const noteRequired = overrides.length > 0 && !note.trim()
  /**
   * How many stored values Approve would overwrite. This is the count the primary button NAMES —
   * one informed click beats a row-by-row confirm ritual, but a bare "Approve" would hide what is
   * being accepted, which is the whole reason these legs are queued.
   */
  const changeCount = useMemo(
    () => conflicts.filter((c) => changesStoredValue(c, resolutions[c.field] ?? '')).length,
    [conflicts, resolutions],
  )
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
          corrections,
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
          corrections,
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
    <div className={embedded ? undefined : 'rounded-xl border border-border bg-surface-800'}>
      {/* Collapsed identity row (§2.1) — suppressed when embedded: the queue row states it already. */}
      {!embedded && (
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
                className={cn(ACTION_BTN, ACTION_VARIANT.success)}
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
                className={cn(ACTION_BTN, ACTION_VARIANT.danger)}
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Expanded: AI comment + conflicts-only + notes + Save&Approve (§2.2) */}
      {(expanded || embedded) && (
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

          {/* Source emails — resolving a conflict means reading what the email actually said, so the
              row has to answer "which email is this, and is it the latest?". Same shape as Related
              Emails on the shipment page, minus the type tag: it read 'Other' on every chip, and the
              timestamp is what actually tells the reviewer which statement supersedes which. */}
          {emails.length > 0 && (
            <div className="space-y-2" data-testid="source-emails">
              <p className="text-[11px] font-medium text-text-muted">Source emails</p>
              {sortedEmails.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => openEmailWindow(e)}
                  aria-label={`Open source email: ${e.subject || '(no subject)'}`}
                  className="flex w-full items-center gap-3 rounded-lg bg-surface-900 p-3 text-left transition-colors hover:bg-surface-700"
                >
                  <Mail size={14} className="shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">{e.subject || '(no subject)'}</p>
                    <p className="text-xs text-text-muted">
                      {e.sender} · <span className="font-mono">{formatDateTime(e.receivedAt)}</span>
                    </p>
                  </div>
                  <ExternalLink size={12} className="shrink-0 text-text-muted opacity-60" />
                </button>
              ))}
            </div>
          )}

          {needsAttentionGroups.length > 0 && (
            <div
              className={cn(
                'rounded-lg bg-surface-900 px-3 py-2',
                editing && 'border-l-2 border-status-warning bg-status-warning/5',
              )}
              data-testid="needs-attention"
              data-editing={editing ? 'true' : 'false'}
            >
              {/* data-testid why-review kept for legacy tests */}
              <div data-testid="why-review">
                <p className="text-[11px] font-medium text-text-muted">Needs attention</p>
                <div className="mt-1.5 space-y-2">
                  {needsAttentionGroups.map((g) => (
                    <div key={g.groupId} data-testid={`needs-group-${g.groupId}`}>
                      <p className="text-[11px] font-medium text-text-secondary">{g.title}</p>
                      <ul className="mt-0.5 space-y-1">
                        {g.items.map((r) => (
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
                  ))}
                </div>
              </div>
            </div>
          )}

          {criticReview == null && (
            <p className="text-[11px] text-text-muted" data-testid="no-critic-note">
              No agent analysis on this leg (committed before the critic payload, or created manually) — open the full shipment to compare values.
            </p>
          )}

          {hasCandidateLegs && matchAmbiguity && (
            <CandidateLegsPanel
              matchAmbiguity={matchAmbiguity}
              currentShipmentId={(shipment as { id?: string }).id}
              readOnly={readOnly}
              onLink={onLink}
            />
          )}

          {showIdentify && (
            <div className="rounded-lg border border-border bg-surface-900 px-3 py-2 space-y-2" data-testid="identify-shipment">
              <p className="text-[11px] font-medium text-text-muted">
                {hasCandidateLegs
                  ? 'Not in the list above? Search by booking / SO / B/L.'
                  : isAmbiguousMatch && !isWeakIdentity
                    ? 'Multiple matching shipments — identify the real one and fold this leg into it if it is a duplicate.'
                    : 'Identify this shipment — type its booking / SO / B/L; if it already exists you can link into it.'}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Identity type"
                  value={identField}
                  onChange={(e) => setIdentField(e.target.value as typeof identField)}
                  className="rounded-md border border-border bg-surface-800 px-2 py-1 text-xs text-text-primary"
                >
                  <option value="booking_no">Booking No.</option>
                  <option value="so_no">SO#</option>
                  <option value="hbl_awb_fcr_no">HBL/AWB/FCR</option>
                </select>
                <input
                  aria-label="Identity value"
                  value={identValue}
                  onChange={(e) => { setIdentValue(e.target.value); setIdentResult(null) }}
                  className="w-44 rounded-md border border-border bg-surface-800 px-2 py-1 font-mono text-xs text-text-primary"
                />
                <button
                  type="button"
                  disabled={identBusy || identValue.trim().length < 3}
                  onClick={async () => {
                    setIdentBusy(true)
                    try { setIdentResult(await onIdentify(identField, identValue.trim())) }
                    finally { setIdentBusy(false) }
                  }}
                  className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                >
                  {identBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                  Apply identity
                </button>
              </div>
              {identResult?.outcome === 'set' && (
                <p className="text-xs text-status-success">Identity set — the leg now carries {identResult.value}. Review and approve as usual.</p>
              )}
              {identResult?.outcome === 'ambiguous' && (
                <p className="text-xs text-status-warning">{identResult.count} shipments carry this key — open Shipments to inspect before linking.</p>
              )}
              {identResult?.outcome === 'candidate' && onLink && (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-800 px-2.5 py-2">
                  <span className="text-xs text-text-secondary">
                    Already exists: <span className="font-mono text-text-primary">{identResult.candidate.jobNo}</span> · {identResult.candidate.matchedValue}
                  </span>
                  <button
                    type="button"
                    disabled={identBusy}
                    onClick={async () => {
                      setIdentBusy(true)
                      try { await onLink(identResult.candidate.shipmentId) }
                      finally { setIdentBusy(false) }
                    }}
                    className={cn(ACTION_BTN, ACTION_VARIANT.success)}
                  >
                    Link into this shipment
                  </button>
                </div>
              )}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              {/* table-fixed: auto layout re-measures when the Proposed cell swaps text for an
                  input, so the columns visibly jumped every time Edit was toggled. Fixed widths
                  make the two modes the same table. */}
              <table className="w-full min-w-[36rem] table-fixed">
                <thead>
                  <tr className="border-b border-border bg-surface-900/50 text-left text-[11px] font-medium text-text-muted">
                    <th className="w-[22%] px-3 py-2">Field</th>
                    <th className="w-[33%] px-3 py-2">Existing</th>
                    <th className="w-[45%] px-3 py-2">AI Proposed</th>
                  </tr>
                </thead>
                {/* Only contested rows render — a field both sides agree on is not a decision. Group
                    headers appear only where that group HAS a conflict, so the table stays short. */}
                {groupConflictFields(conflicts).map(({ group, conflicts: rows }) => (
                  <tbody key={group}>
                    <tr className="border-b border-border bg-surface-900/30">
                      <td
                        colSpan={3}
                        className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted"
                      >
                        {group}
                        <span className="ml-2 font-normal normal-case tracking-normal">
                          ({rows.length} {rows.length === 1 ? 'change' : 'changes'})
                        </span>
                      </td>
                    </tr>
                    {rows.map((c) => {
                      const units = unitsFor(c)
                      return (
                        <ConflictRow
                          key={c.field}
                          conflict={c}
                          value={resolutions[c.field] ?? ''}
                          onChange={(v) => setResolution(c.field, v)}
                          editing={editing && !readOnly}
                          existingUnit={units.existing}
                          proposedUnit={units.proposed}
                        />
                      )
                    })}
                  </tbody>
                ))}
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
                  {overrides.length > 0 && (
                    <span className="font-normal text-status-warning">· required when you override the agent</span>
                  )}
                </label>
                <textarea
                  id={`review-note-${shipment.id}`}
                  aria-label="Note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Why your value beats the agent's? (also trains the next extraction)"
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
                {conflicts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    disabled={busy}
                    className={cn(ACTION_BTN, ACTION_VARIANT.secondary)}
                  >
                    <Pencil size={13} />
                    {editing ? 'Done editing' : 'Edit'}
                  </button>
                )}
                {onDismiss && (
                  <button
                    type="button"
                    onClick={handleDismiss}
                    disabled={busy}
                    className={cn(ACTION_BTN, ACTION_VARIANT.danger)}
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
                    className={cn(ACTION_BTN, ACTION_VARIANT.primary)}
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {changeCount > 0
                      ? `Approve ${changeCount} change${changeCount === 1 ? '' : 's'}`
                      : 'Approve'}
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
