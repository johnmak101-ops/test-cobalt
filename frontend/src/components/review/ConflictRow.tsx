import type { CriticConflict } from '../../lib/critic-review'

export interface ConflictRowProps {
  conflict: CriticConflict
  /** Controlled resolution value. */
  value: string
  onChange: (v: string) => void
  readOnly?: boolean
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

function CandidateCell({
  value,
  source,
  empty = '—',
}: {
  value?: string | null
  source?: string | null
  empty?: string
}) {
  if (value == null || value === '') {
    return <span className="text-text-muted">{empty}</span>
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span className="break-all font-mono text-sm text-text-primary">{value}</span>
      {source && (
        <span className="text-[11px] text-text-muted">({source})</span>
      )}
    </span>
  )
}

/**
 * One contested field: Existing · Proposed · Resolution.
 * Only renders structured `CriticConflict` data — never invents from proposedChanges.
 */
export function ConflictRow({ conflict, value, onChange, readOnly }: ConflictRowProps) {
  const { existing, proposed } = splitCandidates(conflict)
  const inputId = `resolution-${conflict.field}`

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-3 py-2.5 text-xs font-medium text-text-primary">
        <span title={conflict.rationale}>{conflict.label}</span>
      </td>
      <td className="px-3 py-2.5">
        <CandidateCell value={existing?.value} source={existing ? 'system' : null} />
      </td>
      <td className="px-3 py-2.5">
        {proposed.length === 0 ? (
          <span className="text-text-muted">—</span>
        ) : (
          <div className="flex flex-col gap-1">
            {proposed.map((p, i) => (
              <CandidateCell key={`${p.source}-${p.value}-${i}`} value={p.value} source={p.source} />
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        {readOnly ? (
          <span className="break-all font-mono text-sm text-text-primary">
            {value || '—'}
          </span>
        ) : (
          <input
            id={inputId}
            aria-label={`Resolution for ${conflict.label}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Your value"
            className="h-8 w-full min-w-[8rem] rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted"
          />
        )}
      </td>
    </tr>
  )
}
