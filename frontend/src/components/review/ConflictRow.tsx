import type { CriticConflict } from '../../lib/critic-review'
import { reviewFieldLabel, mapCriticFieldToColumn, isPortColumn } from '../../lib/review-fields'
import { PortPicker } from '../shipments/PortPicker'
import { cn } from '../../lib/utils'

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
  /** Critic field has no leg column — show hint; Edit cannot commit it from Review Queue. */
  notWritable?: boolean
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
 * co-current B/Ls); the rest stay visible as selectable options rather than being lost.
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
 *
 * Multi-candidate fields (e.g. two co-current forwarders / HBLs) list every proposal in the
 * AI Proposed column — never bury the 2nd+ option in a browser datalist the operator can't see.
 */
export function ConflictRow({
  conflict,
  value,
  onChange,
  editing,
  existingUnit,
  proposedUnit,
  notWritable = false,
}: ConflictRowProps) {
  const { existing, proposed } = splitCandidates(conflict)
  const changed = changesStoredValue(conflict, value)
  const label = reviewFieldLabel(conflict.field, conflict.label)
  // POL/POD edit from the seeded ports master (searchable, free-text fallback) instead of a bare input.
  const isPort = isPortColumn(mapCriticFieldToColumn(conflict.field))
  const multi = proposed.length > 1

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-3 py-2.5 text-xs font-medium text-text-primary">
        <span title={conflict.rationale}>{label}</span>
        {notWritable && (
          <p className="mt-0.5 text-[10px] font-normal text-status-warning" data-testid="conflict-not-writable">
            Not savable here — open full shipment
          </p>
        )}
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
        {multi && !isPort ? (
          <MultiCandidateProposed
            label={label}
            proposed={proposed}
            value={value}
            onChange={onChange}
            editing={editing}
            proposedUnit={proposedUnit}
            changed={changed}
          />
        ) : editing ? (
          isPort ? (
            <PortPicker
              value={value}
              onChange={onChange}
              ariaLabel={`Proposed value for ${label}`}
              placeholder="—"
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted"
            />
          ) : (
            <span className="inline-flex w-full items-center">
              <input
                aria-label={`Proposed value for ${label}`}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="—"
                className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted"
              />
              {/* The unit is NOT part of the editable text — the operator types a number, not '87 KGS'. */}
              <Unit unit={proposedUnit} />
            </span>
          )
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
      </td>
    </tr>
  )
}

/**
 * Always list every non-system candidate in the AI Proposed cell so operators can see (and pick)
 * co-current values. Read-only: all options visible, current selection highlighted. Edit: radio
 * group to pick a candidate, plus free-text for a custom override.
 */
function MultiCandidateProposed({
  label,
  proposed,
  value,
  onChange,
  editing,
  proposedUnit,
  changed,
}: {
  label: string
  proposed: { value: string; source: string }[]
  value: string
  onChange: (v: string) => void
  editing: boolean
  proposedUnit?: string | null
  changed: boolean
}) {
  const groupName = `candidates-${label.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <div className="space-y-1.5" data-testid="multi-candidate-proposed">
      <ul
        role={editing ? 'radiogroup' : 'list'}
        aria-label={`AI proposed candidates for ${label}`}
        className="space-y-1"
      >
        {proposed.map((c, i) => {
          const selected = value === c.value || (!value && i === 0)
          return (
            <li key={`${c.source}-${c.value}-${i}`}>
              {editing ? (
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors',
                    selected
                      ? 'border-cobalt-primary bg-cobalt-primary/10'
                      : 'border-border bg-surface-900 hover:bg-surface-700',
                  )}
                >
                  <input
                    type="radio"
                    name={groupName}
                    className="mt-0.5 shrink-0"
                    checked={value === c.value}
                    onChange={() => onChange(c.value)}
                    aria-label={`Select proposed candidate: ${c.value}`}
                  />
                  <span className="min-w-0 break-all font-mono text-sm text-text-primary">
                    {c.value}
                    <Unit unit={proposedUnit} />
                  </span>
                </label>
              ) : (
                <div
                  className={cn(
                    'rounded-md border px-2 py-1.5',
                    selected
                      ? changed
                        ? 'border-ai-proposed/40 bg-ai-proposed/5'
                        : 'border-border bg-surface-900/50'
                      : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'break-all font-mono text-sm',
                      selected && changed
                        ? 'font-medium text-ai-proposed'
                        : selected
                          ? 'text-text-primary'
                          : 'text-text-secondary',
                    )}
                  >
                    {c.value}
                    <Unit unit={proposedUnit} />
                  </span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {editing && (
        <div className="space-y-1">
          <p className="text-[10px] text-text-muted">Or type a different value</p>
          <span className="inline-flex w-full items-center">
            <input
              aria-label={`Proposed value for ${label}`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="—"
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted"
            />
            <Unit unit={proposedUnit} />
          </span>
        </div>
      )}
      {!editing && (
        <p className="text-[11px] text-text-muted">{proposed.length} candidates — pick one in Edit</p>
      )}
    </div>
  )
}
