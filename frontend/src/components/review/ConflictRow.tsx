import type { CriticConflict } from '../../lib/critic-review'
import { reviewFieldLabel } from '../../lib/review-fields'

export interface ConflictRowProps {
  conflict: CriticConflict
  /** Controlled value of the Proposed cell (seeded with the agent's proposal). */
  value: string
  onChange: (v: string) => void
  /** Card-level edit mode. Off = a clean read-only diff; on = the value becomes an input. */
  editing: boolean
  /** Unit shown beside the stored value ('KGS', the leg's UOM …). Null = this field has none. */
  existingUnit?: string | null
  /** Unit shown beside the agent's value. Null when we cannot honestly claim one — see ReviewCard. */
  proposedUnit?: string | null
}

/** A number is meaningless without its unit ('14' vs '14 cartons'), so render them together. */
function Unit({ unit }: { unit?: string | null }) {
  if (!unit) return null
  return <span className="ml-1 text-[11px] text-text-muted">{unit}</span>
}

function isSystemSource(source: string): boolean {
  return source.trim().toLowerCase() === 'system'
}

/** Split candidates into Existing (System) vs Proposed (everything else). */
export function splitCandidates(conflict: CriticConflict) {
  const existing = conflict.candidates.find((c) => isSystemSource(c.source)) ?? null
  const proposed = conflict.candidates.filter((c) => !isSystemSource(c.source))
  return { existing, proposed }
}

/** What the system already stores for this field ('' when the field is empty/absent). */
export function existingValueOf(conflict: CriticConflict): string {
  return splitCandidates(conflict).existing?.value ?? ''
}

/**
 * The agent's proposal — the FIRST non-system candidate. A conflict can carry several (two
 * co-current B/Ls); the rest stay reachable through the cell's datalist rather than being lost.
 */
export function proposedValueOf(conflict: CriticConflict): string {
  return splitCandidates(conflict).proposed[0]?.value ?? ''
}

/** True when committing this row would OVERWRITE a stored value — i.e. it is a real change. */
export function changesStoredValue(conflict: CriticConflict, value: string): boolean {
  const v = value.trim()
  return v !== '' && v !== existingValueOf(conflict)
}

/**
 * One contested field: Existing · Proposed.
 * Only renders structured `CriticConflict` data — never invents from proposedChanges.
 */
export function ConflictRow({
  conflict,
  value,
  onChange,
  editing,
  existingUnit,
  proposedUnit,
}: ConflictRowProps) {
  const { existing, proposed } = splitCandidates(conflict)
  const listId = `candidates-${conflict.field}`
  const changed = changesStoredValue(conflict, value)
  const label = reviewFieldLabel(conflict.field, conflict.label)

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-3 py-2.5 text-xs font-medium text-text-primary">
        <span title={conflict.rationale}>{label}</span>
      </td>
      <td className="px-3 py-2.5">
        {existing?.value ? (
          <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
            <span className="break-all font-mono text-sm text-text-primary">
              {existing.value}
              <Unit unit={existingUnit} />
            </span>
            <span className="text-[11px] text-text-muted">(system)</span>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        {editing ? (
          <span className="inline-flex w-full items-center">
            <input
              aria-label={`Proposed value for ${label}`}
              value={value}
              // Only offer a picker when there is genuinely a choice — a one-option dropdown is noise.
              list={proposed.length > 1 ? listId : undefined}
              onChange={(e) => onChange(e.target.value)}
              placeholder="—"
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted"
            />
            {/* The unit is NOT part of the editable text — the operator types a number, not '87 KGS'. */}
            <Unit unit={proposedUnit} />
            {proposed.length > 1 && (
              <datalist id={listId}>
                {proposed.map((c, i) => (
                  <option key={`${c.source}-${c.value}-${i}`} value={c.value} />
                ))}
              </datalist>
            )}
          </span>
        ) : value ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {/* Colour alone carries "this differs from stored" — the arrow said the same thing twice. */}
            <span
              className={
                changed
                  ? 'break-all font-mono text-sm font-medium text-ai-proposed'
                  : 'break-all font-mono text-sm text-text-primary'
              }
            >
              {value}
              <Unit unit={proposedUnit} />
            </span>
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
        {/* `source` is the queue's email_type classification ('Other', 'SO', …), not a document name.
            It is meaningless to a reviewer — and 'Other' is overloaded (real verdict / model said
            nothing / deterministic path never classified), so it cannot even be trusted. The source
            emails are linked by name above the table; that is the thing worth clicking. */}
        {proposed.length > 1 && (
          <p className="mt-1 text-[11px] text-text-muted">{proposed.length} candidates</p>
        )}
      </td>
    </tr>
  )
}
