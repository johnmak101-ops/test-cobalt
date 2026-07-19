import { useState } from 'react'
import { Copy, Plus, X } from 'lucide-react'
import type { CriticConflict } from '../../lib/critic-review'
import {
  reviewFieldLabel,
  mapCriticFieldToColumn,
  isPortColumn,
  parseStyleEntries,
  serializeStyleEntries,
  isMultiStylePaste,
  type StyleEntry,
} from '../../lib/review-fields'
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
  /**
   * When true, operator may change Resolution (Active queue). False on Approved/Rejected —
   * Copy all / paste / Edit inputs are hidden so the panel is view-only.
   */
  canEdit?: boolean
  /** Enter card-level edit mode (used by Copy all when the multi-field editor is not yet open). */
  onRequestEdit?: () => void
  /** When true, field is a critical sailing column — light badge next to label. */
  critical?: boolean
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

/** Item / Style No. is a multi-token list, not one free-text blob. */
function isItemStyleField(field: string): boolean {
  const col = mapCriticFieldToColumn(field)
  return col === 'itemStyleNo' || /item.?style/i.test(field)
}

/**
 * One contested field: Existing · Proposed.
 * Only renders structured `CriticConflict` data — never invents from proposedChanges.
 *
 * Multi-candidate fields (e.g. two co-current forwarders / HBLs) list every proposal in the
 * AI Proposed column — never bury the 2nd+ option in a browser datalist the operator can't see.
 * Item/Style lists use one input per style (not a comma-joined mega-string).
 */
export function ConflictRow({
  conflict,
  value,
  onChange,
  editing,
  existingUnit,
  proposedUnit,
  notWritable = false,
  canEdit = false,
  onRequestEdit,
  critical = false,
}: ConflictRowProps) {
  const { existing, proposed } = splitCandidates(conflict)
  const changed = changesStoredValue(conflict, value)
  const label = reviewFieldLabel(conflict.field, conflict.label)
  const column = mapCriticFieldToColumn(conflict.field)
  // POL/POD edit from the seeded ports master (searchable, free-text fallback) instead of a bare input.
  const isPort = isPortColumn(column)
  const isStyles = isItemStyleField(conflict.field)
  const multi = proposed.length > 1
  const existingStyles = existing?.value ?? ''
  const canCopyAll = canEdit && parseStyleEntries(existingStyles).length > 0

  const copyAllFromExisting = () => {
    if (!canCopyAll) return
    onRequestEdit?.()
    onChange(existingStyles)
  }

  return (
    <tr className="border-b border-border last:border-0 align-top">
      {/* label 14 semibold · values 14 mono — hierarchy via weight/color */}
      <td className="px-3 py-2.5 text-sm font-semibold text-text-primary">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span title={conflict.rationale}>{label}</span>
          {critical && (
            <span
              className="text-[11px] font-medium text-status-warning"
              data-testid="conflict-critical-badge"
            >
              Critical
            </span>
          )}
        </span>
        {notWritable && (
          <p className="mt-0.5 text-[11px] font-normal text-status-warning" data-testid="conflict-not-writable">
            Not savable here — open full shipment
          </p>
        )}
      </td>
      <td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5">
        {existing?.value ? (
          isStyles ? (
            <div className="min-w-0 space-y-1">
              <StyleListDisplay value={existing.value} />
              <span className="text-[11px] text-text-muted">(system)</span>
              {canCopyAll && (
                <button
                  type="button"
                  onClick={copyAllFromExisting}
                  data-testid="style-copy-all-existing"
                  title="Copy all Existing styles into Resolution"
                  className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-cobalt-primary-light hover:bg-cobalt-primary/10"
                >
                  <Copy size={12} /> Copy all →
                </button>
              )}
            </div>
          ) : (
            <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5">
              <span className="field-value font-mono text-sm leading-snug text-text-primary">
                {existing.value}
                <Unit unit={existingUnit} />
              </span>
              <span className="text-[11px] text-text-muted">(system)</span>
            </span>
          )
        ) : (
          <span className="font-mono text-sm text-text-muted">—</span>
        )}
      </td>
      <td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5">
        {isStyles ? (
          editing && canEdit ? (
            <StyleListEditor
              label={label}
              value={value}
              onChange={onChange}
              existingValue={existingStyles}
            />
          ) : value ? (
            <div className="min-w-0 space-y-1">
              <StyleListDisplay
                value={value}
                className={changed ? 'text-ai-proposed font-medium' : 'text-text-primary'}
              />
              {canCopyAll && (
                <button
                  type="button"
                  onClick={copyAllFromExisting}
                  data-testid="style-copy-all"
                  title="Copy all Existing styles into Resolution"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-cobalt-primary-light hover:bg-cobalt-primary/10"
                >
                  <Copy size={12} /> Copy all
                </button>
              )}
            </div>
          ) : (
            <div className="min-w-0 space-y-1">
              <span className="font-mono text-sm text-text-muted">—</span>
              {canCopyAll && (
                <button
                  type="button"
                  onClick={copyAllFromExisting}
                  data-testid="style-copy-all"
                  title="Copy all Existing styles into Resolution"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-cobalt-primary-light hover:bg-cobalt-primary/10"
                >
                  <Copy size={12} /> Copy all
                </button>
              )}
            </div>
          )
        ) : multi && !isPort ? (
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
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5">
            {/* Colour alone carries "this differs from stored" — the arrow said the same thing twice. */}
            <span
              className={cn(
                'field-value font-mono text-sm leading-snug',
                changed ? 'font-medium text-ai-proposed' : 'text-text-primary',
              )}
            >
              {value}
              <Unit unit={proposedUnit} />
            </span>
          </span>
        ) : (
          <span className="font-mono text-sm text-text-muted">—</span>
        )}
      </td>
    </tr>
  )
}

/** Read-only: one style (or PO/style) per line — never a mid-wrap comma blob.
 *  Long lists scroll inside a max-height box so they cannot blow out the review card. */
export function StyleListDisplay({ value, className }: { value: string; className?: string }) {
  const rows = parseStyleEntries(value)
  // Always set 13px — bare "—" must not inherit body 16px.
  if (rows.length === 0) {
    return <span className="font-mono text-sm text-text-muted">—</span>
  }
  return (
    <div className="min-w-0 max-w-full" data-testid="style-list-display">
      <div className="max-h-40 overflow-y-auto overscroll-contain pr-1">
        <ul className="space-y-0.5">
          {rows.map((r, i) => (
            <li
              key={`${r.po}-${r.style}-${i}`}
              className={cn(
                'field-value font-mono text-sm leading-snug',
                className ?? 'text-text-primary',
              )}
            >
              {r.po ? (
                <>
                  <span className="text-text-muted">{r.po}/</span>
                  {r.style}
                </>
              ) : (
                r.style
              )}
            </li>
          ))}
        </ul>
      </div>
      {rows.length > 6 && (
        <p className="mt-1 text-[11px] text-text-muted">{rows.length} styles · scroll for all</p>
      )}
    </div>
  )
}

/**
 * Multi-row Item/Style editor. Each style is its own input; optional PO when the token is PO/STYLE.
 * Serializes back to the comma-joined leg string the API already stores.
 *
 * Bulk UX: **Copy all** fills from Existing; paste a comma list or Excel column/row into any field
 * and the whole list is parsed (tabs + newlines count as separators).
 */
export function StyleListEditor({
  label,
  value,
  onChange,
  existingValue,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** System Existing list — used by Copy all (left → right). */
  existingValue?: string
}) {
  const [rows, setRows] = useState<StyleEntry[]>(() => {
    const parsed = parseStyleEntries(value)
    return parsed.length > 0 ? parsed : [{ po: '', style: '' }]
  })
  // Re-seed when the parent value is replaced from outside (e.g. conflict reseed, multi-candidate pick).
  const [seed, setSeed] = useState(value)
  if (seed !== value && serializeStyleEntries(rows) !== value) {
    setSeed(value)
    const parsed = parseStyleEntries(value)
    setRows(parsed.length > 0 ? parsed : [{ po: '', style: '' }])
  }

  const commit = (next: StyleEntry[]) => {
    setRows(next)
    onChange(serializeStyleEntries(next))
  }

  const update = (i: number, patch: Partial<StyleEntry>) => {
    commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i)
    commit(next.length > 0 ? next : [{ po: '', style: '' }])
  }

  const add = () => commit([...rows, { po: '', style: '' }])

  const copyAllFromExisting = () => {
    const parsed = parseStyleEntries(existingValue)
    if (parsed.length === 0) return
    commit(parsed)
  }

  /** Bulk paste from Excel / comma list replaces the whole Resolution list. */
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!text || !isMultiStylePaste(text)) return // single token → default paste into the focused input
    const parsed = parseStyleEntries(text)
    if (parsed.length === 0) return
    e.preventDefault()
    commit(parsed)
  }

  const showPo = rows.some((r) => r.po.trim())
  const canCopyAll = parseStyleEntries(existingValue).length > 0

  return (
    <div
      className="min-w-0 max-w-full space-y-1.5"
      data-testid="style-list-editor"
      onPaste={handlePaste}
    >
      <div className="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {rows.map((r, i) => (
          <div key={i} className="flex min-w-0 items-center gap-1.5">
            {showPo && (
              <input
                aria-label={`${label} PO ${i + 1}`}
                value={r.po}
                onChange={(e) => update(i, { po: e.target.value })}
                placeholder="PO#"
                className="h-8 w-[30%] min-w-[5rem] shrink-0 rounded-lg border border-border bg-surface-900 px-2 font-mono text-sm text-text-primary placeholder:text-text-muted"
              />
            )}
            <input
              aria-label={
                rows.length === 1 ? `Proposed value for ${label}` : `${label} style ${i + 1}`
              }
              value={r.style}
              onChange={(e) => update(i, { style: e.target.value })}
              placeholder="Style / item no. — or paste a list"
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted"
            />
            <button
              type="button"
              title="Remove style"
              aria-label={`Remove style ${i + 1}`}
              onClick={() => remove(i)}
              disabled={rows.length <= 1 && !r.style && !r.po}
              className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-surface-700 hover:text-status-critical disabled:opacity-30"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {canCopyAll && (
          <button
            type="button"
            onClick={copyAllFromExisting}
            data-testid="style-copy-all"
            title="Copy all Existing styles into Resolution"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-cobalt-primary-light hover:bg-cobalt-primary/10"
          >
            <Copy size={12} /> Copy all
          </button>
        )}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-cobalt-primary-light hover:bg-cobalt-primary/10"
        >
          <Plus size={12} /> Add style
        </button>
        {rows.length > 6 && (
          <span className="text-[11px] text-text-muted">{rows.length} styles · scroll for all</span>
        )}
      </div>
      <p className="text-[11px] text-text-muted">
        Paste a comma list or Excel column to replace all styles
      </p>
    </div>
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
                    'flex cursor-pointer items-start gap-2 rounded border px-2 py-1 text-xs transition-colors',
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
                  <span className="field-value font-mono text-sm leading-snug text-text-primary">
                    {c.value}
                    <Unit unit={proposedUnit} />
                  </span>
                </label>
              ) : (
                <div
                  className={cn(
                    'inline-flex max-w-full rounded border px-2 py-0.5',
                    selected
                      ? changed
                        ? 'border-ai-proposed/40 bg-ai-proposed/5'
                        : 'border-border bg-surface-900/50'
                      : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'field-value font-mono text-sm leading-snug',
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
          <p className="text-[11px] text-text-muted">Or type a different value</p>
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
        <p className="text-[11px] text-text-muted">
          {proposed.length} candidates — pick one in Edit
        </p>
      )}
    </div>
  )
}
