/**
 * #129 multi-candidate match: closed-set leg picker.
 * Selection only — merge happens on the card primary action (Link & apply) after field decisions.
 */
import type { MatchAmbiguity } from '../../lib/critic-review'
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

function dash(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  return s || '—'
}

function emailKeyLine(emailKey: Record<string, string> | undefined): string {
  if (!emailKey || !Object.keys(emailKey).length) return '—'
  const labels: Record<string, string> = {
    booking_no: 'Booking',
    so_no: 'SO',
    hbl_awb_fcr_no: 'HBL',
    mbl: 'MBL',
    container_no: 'Container',
    customer_po: 'PO',
  }
  return Object.entries(emailKey)
    .map(([k, v]) => `${labels[k] ?? k}=${v}`)
    .join(' · ')
}

export function CandidateLegsPanel({
  matchAmbiguity,
  currentShipmentId,
  readOnly = false,
  selectedId,
  onSelect,
}: CandidateLegsPanelProps) {
  const candidates = matchAmbiguity.candidates ?? []
  const suggestedId =
    matchAmbiguity.suggestion && !matchAmbiguity.suggestion.cannotDecide
      ? matchAmbiguity.suggestion.shipmentId
      : null

  if (candidates.length < 2) return null

  return (
    <div
      className="rounded-lg border border-border bg-surface-900 px-3 py-2 space-y-2"
      data-testid="candidate-legs-panel"
    >
      <p className="text-[11px] font-medium text-text-muted">
        Which shipment does this email update?
      </p>
      <p className="text-xs text-text-secondary">
        Email keys: <span className="font-mono text-text-primary">{emailKeyLine(matchAmbiguity.emailKey)}</span>
        {matchAmbiguity.candidateCount != null &&
          matchAmbiguity.candidateCount > candidates.length && (
            <span className="text-text-muted">
              {' '}
              · showing {candidates.length} of {matchAmbiguity.candidateCount}
            </span>
          )}
      </p>

      {matchAmbiguity.sharedContainer && (
        <p
          className="rounded-md bg-status-warning/10 px-2 py-1.5 text-xs text-status-warning"
          data-testid="shared-container-banner"
        >
          Shared container (拼櫃):{' '}
          <span className="font-mono">{matchAmbiguity.sharedContainer}</span>
          {' — '}
          several bookings may share this container; pick which booking this email updates.
        </p>
      )}

      {suggestedId && matchAmbiguity.suggestion && !matchAmbiguity.suggestion.cannotDecide && (
        <p className="text-[11px] text-text-muted" data-testid="candidate-suggestion">
          Suggested:{' '}
          <span className="font-mono text-text-secondary">
            {candidates.find((c) => c.shipmentId === suggestedId)?.jobNo ??
              `${suggestedId.slice(0, 8)}…`}
          </span>
          {matchAmbiguity.suggestion.source === 'llm_rank' && (
            <span className="text-text-muted"> (model)</span>
          )}
          {matchAmbiguity.suggestion.source === 'deterministic_rank' && (
            <span className="text-text-muted"> (key overlap)</span>
          )}
          {matchAmbiguity.suggestion.rationale
            ? ` — ${matchAmbiguity.suggestion.rationale}`
            : ''}
          {' · select below, resolve fields, then Link & apply'}
        </p>
      )}

      <ul className="space-y-1.5" role="radiogroup" aria-label="Matching shipments">
        {candidates.map((c) => {
          const isSelf = currentShipmentId != null && c.shipmentId === currentShipmentId
          const isSuggested = suggestedId === c.shipmentId
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
                  aria-label={`Select ${c.jobNo ?? c.shipmentId}`}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono font-medium text-text-primary">
                      {dash(c.jobNo)}
                    </span>
                    {isSuggested && (
                      <span className="rounded bg-cobalt-primary/20 px-1 py-0.5 text-[10px] text-cobalt-primary-light">
                        suggested
                      </span>
                    )}
                    {isSelf && (
                      <span className="text-[10px] text-text-muted">(this provisional)</span>
                    )}
                  </div>
                  <div className="field-value font-mono text-[11px] text-text-secondary">
                    BK {dash(c.booking_no)} · SO {dash(c.so_no)} · HBL {dash(c.hbl_awb_fcr_no)} · CTR{' '}
                    {dash(c.container_no)}
                  </div>
                  {(c.etd || c.vesselOrFlight || (c.pos && c.pos.length > 0)) && (
                    <div className="field-value text-[11px] text-text-muted">
                      {c.vesselOrFlight && <span>{c.vesselOrFlight} · </span>}
                      {c.etd && <span>ETD {formatDateMaybeTime(c.etd)}</span>}
                      {c.pos && c.pos.length > 0 && (
                        <span>
                          {c.etd ? ' · ' : ''}
                          PO {c.pos.slice(0, 4).join(', ')}
                          {c.pos.length > 4 ? '…' : ''}
                        </span>
                      )}
                    </div>
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
            <>Select a shipment, resolve field conflicts below, then Link &amp; apply.</>
          )}
        </p>
      )}
    </div>
  )
}
