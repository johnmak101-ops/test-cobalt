/**
 * #129 multi-candidate match: closed-set leg picker.
 * Hybrid-C E4: business keys (SO / booking / HBL / container) are primary;
 * JOB# is secondary internal metadata only (virtual master — operators do not use it as identity).
 * Selection only — merge happens on the card primary action (Link & apply) after field decisions.
 */
import { useState } from 'react'
import type { MatchAmbiguity, MatchAmbiguityCandidate } from '../../lib/critic-review'
import { isNonIdentifiableCandidate, nonIdentifierValues } from '../../lib/identifier-shape'
import { diffCandidates, type CandidateDiff } from '../../lib/candidate-diff'
import { cn, formatDateMaybeTime } from '../../lib/utils'

export interface CandidateLegsPanelProps {
  matchAmbiguity: MatchAmbiguity
  /** Current provisional leg id — cannot select self as link target */
  currentShipmentId?: string
  readOnly?: boolean
  /** Controlled selection (parent owns Link & apply). */
  selectedId: string | null
  onSelect: (shipmentId: string | null) => void
}

/** Primary operator-facing label — business keys first, never JOB-led. */
export function candidateBizKeyTitle(c: MatchAmbiguityCandidate): string {
  const parts: string[] = []
  if ((c.so_no ?? '').trim()) parts.push(`SO ${c.so_no!.trim()}`)
  if ((c.booking_no ?? '').trim()) parts.push(`BK ${c.booking_no!.trim()}`)
  if ((c.hbl_awb_fcr_no ?? '').trim()) parts.push(`HBL ${c.hbl_awb_fcr_no!.trim()}`)
  if ((c.container_no ?? '').trim()) parts.push(`CTR ${c.container_no!.trim()}`)
  if (parts.length) return parts.slice(0, 3).join(' · ')
  if ((c.pos ?? []).length) return `PO ${c.pos!.slice(0, 2).join(', ')}`
  return `${c.shipmentId.slice(0, 8)}…`
}

/** The identifier fields that tell THIS candidate apart, in the order an operator reads them. */
function rowIdentifiers(c: MatchAmbiguityCandidate, diff: CandidateDiff): string {
  return diff.differing
    .filter((f) => f.identifier)
    .map((f) => {
      const v = String((c as unknown as Record<string, unknown>)[f.key] ?? '').trim()
      return v ? `${f.label} ${v}` : null
    })
    .filter((s): s is string => s != null)
    .join(' · ')
}

/** The non-identifier fields that differ — vessel, ETD, customer, JOB. */
function rowContext(c: MatchAmbiguityCandidate, diff: CandidateDiff): string[] {
  return diff.differing
    .filter((f) => !f.identifier)
    .map((f) => {
      const raw = (c as unknown as Record<string, unknown>)[f.key]
      const v = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim()
      if (!v) return null
      if (f.key === 'etd') return `ETD ${formatDateMaybeTime(v)}`
      return f.label ? `${f.label} ${v}` : v
    })
    .filter((s): s is string => s != null)
}

export function CandidateLegsPanel({
  matchAmbiguity,
  currentShipmentId,
  readOnly = false,
  selectedId,
  onSelect,
}: CandidateLegsPanelProps) {
  const allCandidates = matchAmbiguity.candidates ?? []
  const suggestedId =
    matchAmbiguity.suggestion && !matchAmbiguity.suggestion.cannotDecide
      ? matchAmbiguity.suggestion.shipmentId
      : null

  /**
   * A leg whose every identifier is digit-free was parsed out of a spreadsheet HEADER — `SO no.`,
   * `PORT OF LOADING`. Merging live cargo into one is irreversible and always wrong, so it is not
   * offered by default. Not deleted and not hidden outright: the reason is stated and one click brings
   * it back, because the value itself is real data the operator may need to see (see identifier-shape).
   */
  const [showUnidentifiable, setShowUnidentifiable] = useState(false)
  const unidentifiable = allCandidates.filter(isNonIdentifiableCandidate)
  const candidates =
    showUnidentifiable || unidentifiable.length === 0
      ? allCandidates
      : allCandidates.filter((c) => !isNonIdentifiableCandidate(c))

  /** What is shared vs what tells them apart — computed over the rows actually shown. */
  const diff = diffCandidates(candidates)

  if (allCandidates.length < 2) return null

  return (
    <div
      className="rounded-lg border border-border bg-surface-900 px-3 py-2 space-y-2"
      data-testid="candidate-legs-panel"
    >
      {/* No title here. The card's own headline asks "Which shipment does this email update?" and this
          panel sits directly under it — printing the question twice, with the answer four blocks below
          the first one, was what made the operator ask where to start. The email keys move into that
          headline's subtext, where they explain what there is to match ON. */}

      {/* Everything every candidate shares, said once. On the five legs of S13784413 that was SO, JOB
          and PO identical across all of them — repeated five times, burying the HBL that differed. */}
      {(diff.shared.length > 0 || diff.absentIdentifiers.length > 0) && (
        <p
          className="border-l-2 border-surface-600 pl-2 font-mono text-[11px] text-text-muted"
          data-testid="candidate-shared-line"
        >
          {diff.shared.length > 0 && (
            <>
              All {candidates.length} ·{' '}
              {diff.shared
                .map((f) => (f.label ? `${f.label} ${f.value}` : f.value))
                .join(' · ')}
            </>
          )}
          {diff.absentIdentifiers.length > 0 && (
            <span className="text-text-muted">
              {diff.shared.length > 0 ? ' · ' : ''}
              no {diff.absentIdentifiers.join(' / ')} on any
            </span>
          )}
        </p>
      )}

      {matchAmbiguity.candidateCount != null &&
        matchAmbiguity.candidateCount > candidates.length && (
          <p className="text-[11px] text-text-muted">
            Showing {candidates.length} of {matchAmbiguity.candidateCount}
          </p>
        )}

      {unidentifiable.length > 0 && !showUnidentifiable && (
        <p className="text-[11px] text-text-muted" data-testid="candidate-unidentifiable-note">
          {unidentifiable.length} more matched, but{' '}
          {unidentifiable.length === 1 ? 'its identifier is' : 'their identifiers are'} not
          identifiers —{' '}
          <span className="font-mono text-status-critical">
            {[...new Set(unidentifiable.flatMap(nonIdentifierValues))]
              .slice(0, 3)
              .map((v) => `“${v}”`)
              .join(', ')}
          </span>
          . Likely parsed from a table header, so not offered.{' '}
          <button
            type="button"
            onClick={() => setShowUnidentifiable(true)}
            className="font-medium text-cobalt-primary-light hover:underline"
          >
            Show anyway
          </button>
        </p>
      )}

      <ul className="space-y-1.5" role="radiogroup" aria-label="Matching shipments by business key">
        {candidates.map((c) => {
          const isSelf = currentShipmentId != null && c.shipmentId === currentShipmentId
          const isSuggested = suggestedId === c.shipmentId
          const title = candidateBizKeyTitle(c)
          return (
            <li key={c.shipmentId}>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors',
                  selectedId === c.shipmentId
                    ? 'border-cobalt-primary bg-cobalt-primary/10'
                    : 'border-border bg-surface-800 hover:bg-surface-700',
                  isSelf && 'opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="match-candidate"
                  className="mt-0.5"
                  checked={selectedId === c.shipmentId}
                  disabled={readOnly || isSelf}
                  onChange={() => onSelect(c.shipmentId)}
                  aria-label={`Select ${title}`}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="font-mono font-medium text-text-primary"
                      data-testid="candidate-biz-title"
                    >
                      {/* Only the identifiers that actually tell these candidates apart. When every
                          one is shared (hoisted above), fall back to the full key title so the row is
                          never blank. */}
                      {rowIdentifiers(c, diff) || title}
                    </span>
                    {c.container_no &&
                      matchAmbiguity.sharedContainer &&
                      c.container_no.trim().toUpperCase() ===
                        matchAmbiguity.sharedContainer.trim().toUpperCase() && (
                        /* The 拼櫃 warning was a whole banner above the list saying a container is
                           shared. It belongs on the rows that actually carry it. */
                        <span
                          className="rounded bg-status-warning/15 px-1 py-0.5 text-[10px] text-status-warning"
                          title="Shared container (拼櫃) — several bookings may move in it, so the container alone cannot identify this shipment"
                          data-testid="candidate-shared-container-tag"
                        >
                          拼櫃
                        </span>
                      )}
                    {isSuggested && (
                      <span className="rounded bg-cobalt-primary/20 px-1 py-0.5 text-[10px] text-cobalt-primary-light">
                        suggested
                      </span>
                    )}
                    {isSelf && (
                      <span className="text-[10px] text-text-muted">(this provisional)</span>
                    )}
                  </div>
                  {rowContext(c, diff).length > 0 && (
                    <div className="field-value font-mono text-[11px] text-text-muted">
                      {rowContext(c, diff).join(' · ')}
                    </div>
                  )}
                  {/* Why THIS one is suggested, on the row it is about. It used to sit in a grey
                      sentence above the list, far from the option it described. */}
                  {isSuggested && matchAmbiguity.suggestion?.rationale && (
                    <p
                      className="text-[10.5px] text-cobalt-primary-light"
                      data-testid="candidate-suggestion-reason"
                    >
                      ↳ {matchAmbiguity.suggestion.rationale}
                      {matchAmbiguity.suggestion.source === 'llm_rank' && ' (model)'}
                      {matchAmbiguity.suggestion.source === 'deterministic_rank' && ' (key overlap)'}
                    </p>
                  )}
                </div>
              </label>
            </li>
          )
        })}
      </ul>

      {!readOnly && (
        <p className="text-[11px] text-text-muted" data-testid="candidate-select-hint">
          {selectedId && selectedId !== currentShipmentId ? (
            <>
              Selected for update — resolve fields below, then use{' '}
              <span className="font-medium text-text-secondary">Link &amp; apply</span>.
            </>
          ) : (
            <>Select a shipment by business key, resolve fields below, then Link &amp; apply.</>
          )}
        </p>
      )}
    </div>
  )
}
