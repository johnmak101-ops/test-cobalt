import { useState } from 'react'
import { Copy, Mail, Plus, X } from 'lucide-react'
import type { CriticCandidate, CriticConflict } from '../../lib/critic-review'
import {
  reviewFieldLabel,
  mapCriticFieldToColumn,
  isPortColumn,
  partyPickerKind,
  isNumericColumn,
  numericFieldWarn,
  formatNumericDisplay,
  normalizeNumericInput,
  parseStyleEntries,
  serializeStyleEntries,
  parseStyleTokens,
  serializeStyleTokens,
  isMultiStylePaste,
  type StyleEntry,
  isDateColumn,
  dateColumnHasTime,
  fieldOptions,
} from '../../lib/review-fields'
import { PortPicker } from '../shipments/PortPicker'
import { NumberField } from '../shipments/NumberField'
import { PartyPicker } from '../shipments/PartyPicker'
import { cn } from '../../lib/utils'
import { REVIEW_COL, REVIEW_TD } from './review-table-layout'
import { DateTimeField } from '../shipments/DateTimeField'

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
  /** Turns a candidate's queue-side sourceEmailId into an openable email; null → no icon. */
  resolveSourceEmail?: ResolveSourceEmail
  /** When set, Current column shows this instead of critic system candidate (qty live-leg). */
  existingOverride?: string | null
}

/** A number is meaningless without its unit ('14' vs '14 cartons'), so render them together. */
function Unit({ unit }: { unit?: string | null }) {
  if (!unit) return null
  return <span className="ml-1 text-[11px] text-text-muted">{unit}</span>
}

/** Mesh master code beside the party name (variant A) — the code is a chip, never part of the
 *  committed value string. */
function MasterCodeChip({ code }: { code: string }) {
  return (
    <span
      data-testid="master-code-chip"
      className="mr-1.5 inline-block shrink-0 rounded border border-cobalt-primary/40 bg-cobalt-primary/10 px-1 align-[1px] font-mono text-[11px] font-medium leading-4 text-cobalt-primary-light"
    >
      {code}
    </span>
  )
}

/** Letter-bearing party name with no Mesh master — honest miss marker (matches the Needs
 *  Attention "not found in Mesh Database" panel; numeric leaks never get this, backend-guarded). */
function MeshMissTag() {
  return (
    <span
      data-testid="mesh-miss-tag"
      className="ml-1.5 inline-block shrink-0 whitespace-nowrap rounded bg-status-warning/15 px-1.5 align-[1px] text-[11px] font-medium leading-4 text-status-warning"
    >
      not in Mesh
    </span>
  )
}

function isSystemSource(source: string): boolean {
  return source.trim().toLowerCase() === 'system'
}

/**
 * Resolve a candidate's queue-side `sourceEmailId` (a graphMessageId) to something openable.
 * Returns null when the email is not among this shipment's related emails, or its body is gone —
 * the icon then does not render at all. A link that opens the WRONG email is worse than no link,
 * so nothing here guesses.
 */
export type ResolveSourceEmail = (
  sourceEmailId: string | null | undefined,
  /** The candidate's value — the evidence panel highlights it in the email body. */
  candidateValue?: string | null,
) => { open: () => void; title: string } | null

// The inline SourceEmailIcon is gone — it sat after the value text where it read as punctuation.
// Its replacement is the Reference Email column (SourceEmailCell, below the main row).

/** Split candidates into Existing (System) vs Proposed (everything else). */
export function splitCandidates(conflict: CriticConflict) {
  const existing = conflict.candidates.find((c) => isSystemSource(c.source)) ?? null
  const proposed = conflict.candidates.filter((c) => !isSystemSource(c.source))
  return { existing, proposed }
}

/** The critic's pre-commit snapshot of this field ('' when it emitted no System candidate). */
export function existingValueOf(conflict: CriticConflict): string {
  return splitCandidates(conflict).existing?.value ?? ''
}

/**
 * A date as this desk reads and edits it: `YYYY-MM-DD`, plus `THH:mm` when a clock time is actually
 * set (only the cut-off family carries one).
 *
 * The leg column holds an instant and `open-decisions.ts` ships it through `toISOString()`, so
 * Current printed `2026-09-05T00:00:00.000Z` beside the email's clean `2026-09-09` — two renderings
 * of the same kind of thing, with the tail left for the operator to strip by eye. It is also the form
 * the row's RESOLUTION must hold, now that the seed IS the stored value: `DateTimeField` reads
 * exactly `YYYY-MM-DD[THH:mm]`, so an ISO instant would come back out of the calendar as a change
 * nobody made.
 *
 * Done here, at the point of use, rather than in `open-decisions.ts` — that value also feeds
 * `sameStoredValue`, and reformatting at the source would move the comparison semantics with it.
 */
const ISO_DATE =
  /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
function reviewDateForm(raw: string): string {
  const m = raw.trim().match(ISO_DATE)
  if (!m) return raw.trim()
  return m[2] && m[2] !== '00:00' ? `${m[1]}T${m[2]}` : m[1]!
}

/**
 * The form a value takes once it IS this row's resolution — what a decision POSTS, and the only form
 * the row compares in.
 *
 * Numerics lose their thousands separators (a packing list writes "1,240", the leg stores 1240, and
 * `Number()` cannot read the grouped one back); dates lose their ISO tail. Every path that decides —
 * the seed, a take, `changesStoredValue`, `candidateMatches` — goes through here, so the same value
 * written two ways can never be reported as a disagreement.
 */
export function resolutionForm(field: string, raw: string | null | undefined): string {
  const column = mapCriticFieldToColumn(field)
  const v = String(raw ?? '').trim()
  if (isNumericColumn(column)) return normalizeNumericInput(v)
  if (isDateColumn(column)) return reviewDateForm(v)
  return v
}

/**
 * What the leg stores for this field RIGHT NOW — the value the Current column prints, and the value
 * the row's resolution holds until the operator decides otherwise.
 *
 * `liveValue` is the leg read back after the commit (backend `openDecisions.liveValues`). The critic's
 * `System` candidate is only a pre-commit snapshot, and the queue emits one ONLY for backendMismatches
 * (`buildConflicts` in cobalt-queue) — a multi-id or party row carries no System candidate at all.
 *
 * The display already preferred the live value and labelled it "(on shipment)", but every DECISION
 * below read `existingValueOf()`, so the card compared against a value it was not showing. On a leg
 * storing MACFUN with no System candidate that meant `'MACFUN' !== ''` — counted as a change, which is
 * what produced "Shipping (1 change)", "Apply MACFUN" and "Leave Blank" on a leg that already had
 * MACFUN. Display and logic must read through this one accessor.
 */
export function currentValueOf(
  conflict: CriticConflict,
  liveValue?: string | null,
): string {
  const live = String(liveValue ?? '').trim()
  return resolutionForm(conflict.field, live !== '' ? live : existingValueOf(conflict))
}

/**
 * The agent's proposal — the FIRST non-system candidate. A conflict can carry several (two
 * co-current B/Ls); the rest stay visible as selectable options rather than being lost.
 */
export function proposedValueOf(conflict: CriticConflict): string {
  return splitCandidates(conflict).proposed[0]?.value ?? ''
}

/** The value a pick POSTS (#360): the resolved master's CODE when the candidate carries one —
 *  the party re-resolver (exactPartyId) matches code-exact FIRST, so codes re-link the booking
 *  FK deterministically where full names depend on a unique normalized-name hit. Candidates
 *  without a master (mesh miss / non-party fields) keep their raw value. */
export function resolutionValueOf(candidate: { value: string; master?: { code: string } | null }): string {
  return candidate.master?.code?.trim() || candidate.value
}

/**
 * What TAKING this candidate posts: its resolution value (#360: the master CODE when it resolved),
 * in the row's resolution form.
 *
 * The two steps have to be one function. `resolutionValueOf` alone hands back whatever the email
 * wrote — "1,240" off a packing list — and `coerceLegField` turns anything `Number()` cannot read
 * into NULL, so a take of a grouped quantity would have WIPED it.
 */
export function takeValueOf(
  conflict: CriticConflict,
  candidate: { value: string; master?: { code: string } | null },
): string {
  return resolutionForm(conflict.field, resolutionValueOf(candidate))
}

/** `v` identifies this candidate — as its resolution value (code) or its raw value. Tolerant on
 *  purpose: reads accept either convention, writes always post takeValueOf (#360). */
function candidateMatches(
  conflict: CriticConflict,
  candidate: { value: string; master?: { code: string } | null },
  v: string,
): boolean {
  const t = String(v ?? '').trim()
  // Blank is "leave this field alone", never a pick — otherwise an empty resolution would match a
  // candidate the email offered as an empty string and read as chosen.
  if (t === '') return false
  return takeValueOf(conflict, candidate) === resolutionForm(conflict.field, t) || candidate.value === t
}

/** True when `v` IS one of the proposed candidates — a pick, not a custom override (picks never
 *  require an override note). */
export function isCandidateResolution(conflict: CriticConflict, v: string): boolean {
  return splitCandidates(conflict).proposed.some((c) => candidateMatches(conflict, c, v))
}

/** True when committing this row would OVERWRITE a stored value — i.e. it is a real change.
 *  Pass `liveValue` so the comparison uses what the leg stores, not the critic snapshot. */
export function changesStoredValue(
  conflict: CriticConflict,
  value: string,
  liveValue?: string | null,
): boolean {
  const v = resolutionForm(conflict.field, value)
  return v !== '' && v !== currentValueOf(conflict, liveValue)
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
 * Multi-candidate fields (e.g. two co-current forwarders / HBLs) list every value the thread stated
 * in the "Also Seen In Email" column — never bury the 2nd+ option in a browser datalist the operator can't see.
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
  existingOverride = null,
  resolveSourceEmail,
}: ConflictRowProps) {
  const { existing, proposed } = splitCandidates(conflict)
  // Compare against what the leg stores (the value this row PRINTS), not the critic snapshot.
  const changed = changesStoredValue(conflict, value, existingOverride)
  // The candidate the controlled value currently equals — chips come from IT, never from a
  // free-typed override (a custom value has no known master).
  const label = reviewFieldLabel(conflict.field, conflict.label)
  const column = mapCriticFieldToColumn(conflict.field)
  // POL/POD edit from the seeded ports master (searchable, free-text fallback) instead of a bare input.
  const isPort = isPortColumn(column)
  // Customer/Vendor/Forwarder do the same over the Mesh party mirror — derived from EDITABLE_FIELDS
  // so this row and the shipment edit form cannot disagree about how a field is edited.
  const partyKind = partyPickerKind(column)
  // Numeric columns restrict on entry and group on display — same rules the edit form applies.
  const isNumeric = isNumericColumn(column)
  const numErr = isNumeric && column ? numericFieldWarn(column, value) : null
  // Dates get the shared calendar+clock control; they used to fall through to a bare text box.
  const isDate = isDateColumn(column)
  /** Enum-constrained columns (UOM, Mode) get the same `<select>` the Order Details form renders. */
  const enumOptions = fieldOptions(column, existingValueOf(conflict) || existingOverride)
  const isStyles = isItemStyleField(conflict.field)
  const multi = proposed.length > 1
  const existingStyles = existing?.value ?? ''
  const canCopyAll = canEdit && parseStyleEntries(existingStyles).length > 0
  const useLiveExisting =
    existingOverride != null && existingOverride !== ''
  // Same accessor the decisions use, so the cell and the buttons can never disagree. It is also the
  // row's DEFAULT resolution — what the card seeds with and what un-taking returns to.
  const existingDisplay = currentValueOf(conflict, existingOverride)
  const existingSourceLabel = useLiveExisting ? '(on shipment)' : '(system)'
  /** How a value PRINTS here: numbers grouped for reading, a timed date without its `T` join. */
  const printed = (raw: string): string =>
    isNumeric
      ? formatNumericDisplay(raw)
      : isDate
        ? reviewDateForm(raw).replace('T', ' ')
        : raw

  /**
   * WHAT THE EMAIL SAID — fixed data on the conflict, independent of anything the operator has done.
   *
   * This column used to render `value` (the RESOLUTION) and then look up whichever candidate happened
   * to match it (`activeProposed`), which fused two jobs into one cell: "what the email said" and
   * "what will be written". Harmless while the resolution is seeded FROM the proposal — the two are
   * equal, so the fusion is invisible — and the reason the column cannot be re-seeded from the stored
   * value: doing that made the email's value vanish from the row entirely, because the row was never
   * rendering the email's value in the first place.
   *
   * Reading the candidate directly decouples them. Display now comes from the conflict; the decision
   * lives in `value` alone, and the two are free to differ.
   */
  const emailCandidate = proposed[0] ?? null

  /**
   * TAKING the email's value — the whole gesture, one box, same as the PO grid's add-tick.
   *
   * The row opens holding what the leg already stores, so without this the email's value is readable
   * and unreachable: the only way to apply it was to open the multi-field editor and retype it by
   * hand. Ticking swaps the resolution to the candidate; unticking puts the stored value back, which
   * is the way out a radio never had.
   *
   * Read mode only, and only where the operator may resolve at all — edit mode replaces the cell with
   * the input, and resolved history decides nothing.
   */
  const takeValue = emailCandidate ? takeValueOf(conflict, emailCandidate) : ''
  /** Nothing to take when the email's value is already the leg's — a box that changes nothing. */
  const takeable = takeValue !== '' && takeValue !== existingDisplay
  const taken = takeable && resolutionForm(conflict.field, value) === takeValue
  const canTake = canEdit && !editing && takeable
  /**
   * Does the value this cell PRINTS differ from what the leg holds?
   *
   * It used to be `changed`, which asks about the RESOLUTION — the same question only while the
   * resolution was seeded from the proposal. Now that the row opens on the stored value, `changed`
   * is false on open, and reading the colour off it would have painted every untaken email value in
   * the same ink as the Current column beside it, erasing the one thing the column is there to say.
   */
  const seenDiffers = emailCandidate ? takeable : changed

  /**
   * WHAT WILL BE WRITTEN, when that is not one of the offered values — a typed override.
   *
   * Only meaningful once display stopped being the resolution: before this, a custom value simply
   * replaced what the cell showed and there was nothing to distinguish "the email said X" from "a
   * human typed X". Compared against the stored value too, so choosing to keep what is there is not
   * reported as an override of it.
   */
  const overrideValue =
    value.trim() !== '' &&
    !proposed.some((p) => candidateMatches(conflict, p, value)) &&
    resolutionForm(conflict.field, value) !== existingDisplay
      ? value
      : null

  const copyAllFromExisting = () => {
    if (!canCopyAll) return
    onRequestEdit?.()
    onChange(existingStyles)
  }

  return (
    <tr className="border-b border-border last:border-0 align-top">
      {/* Must use REVIEW_COL so stacked PO + conflict tables share one grid. */}
      <td className={cn(REVIEW_COL.label, REVIEW_TD, 'font-semibold text-text-primary')}>
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
      <td className={cn(REVIEW_COL.existing, REVIEW_TD)}>
        {existingDisplay ? (
          isStyles ? (
            <div className="min-w-0 space-y-1">
              <StyleListDisplay value={existingDisplay} />
              <span className="text-[11px] text-text-muted">{existingSourceLabel}</span>
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
                {!useLiveExisting && existing?.master ? (
                  <MasterCodeChip code={existing.master.code} />
                ) : null}
                {printed(existingDisplay)}
                <Unit unit={existingUnit} />
                {!useLiveExisting && existing?.master === null ? <MeshMissTag /> : null}
              </span>
              <span className="text-[11px] text-text-muted">{existingSourceLabel}</span>
            </span>
          )
        ) : (
          <span className="font-mono text-sm text-text-muted">—</span>
        )}
      </td>
      <td className={cn(REVIEW_COL.proposed, REVIEW_TD)}>
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
                className={changed ? 'text-review-seen' : 'text-text-primary'}
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
            conflict={conflict}
            label={label}
            proposed={proposed}
            value={value}
            keepValue={existingDisplay}
            keepLabel={printed(existingDisplay)}
            onChange={onChange}
            editing={editing}
            canEdit={canEdit}
            onRequestEdit={onRequestEdit}
            proposedUnit={proposedUnit}
          />
        ) : editing ? (
          isPort ? (
            <PortPicker
              value={value}
              onChange={onChange}
              ariaLabel={`Proposed value for ${label}`}
              placeholder="—"
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          ) : partyKind ? (
            <PartyPicker
              kind={partyKind}
              value={value}
              onChange={onChange}
              ariaLabel={`Proposed value for ${label}`}
              placeholder="—"
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          ) : enumOptions ? (
            /* UOM / Mode are enum-constrained on the leg. This row used to be the ONE surface that
               let them be free-typed — which is how a UOM of `cartonssdfsdf` becomes reachable. */
            <select
              aria-label={`Proposed value for ${label}`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2 font-mono text-sm text-text-primary focus:border-cobalt-primary focus:outline-none"
            >
              {/* Clearing is a legitimate answer, and a select with no empty option cannot express
                  it — the operator would be forced to pick a unit they may not have. */}
              <option value="">—</option>
              {enumOptions.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : isDate ? (
            <DateTimeField
              value={value}
              onChange={onChange}
              showTime={dateColumnHasTime(column)}
              label={`Proposed value for ${label}`}
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
          ) : (
            isNumeric ? (
              <NumberField
                ariaLabel={`Proposed value for ${label}`}
                value={value}
                onChange={onChange}
                decimals={column !== 'qty'}
                unit={proposedUnit}
                error={numErr}
                placeholder="—"
                className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
              />
            ) : (
            <span className="inline-flex w-full flex-wrap items-center">
              <input
                aria-label={`Proposed value for ${label}`}
                /**
                 * Numeric columns restrict at entry, matching the Order Details edit form. Without
                 * this the row was plain text, and coerceLegField turns anything Number() cannot
                 * read into NULL — so an operator typing "1,240" (or pasting it off a packing list)
                 * silently WIPED the quantity. That function's docstring justifies the null with
                 * "the number <input> already blocks that at entry"; this is the input it meant.
                 */
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="—"
                className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
              />
              {/* The unit is NOT part of the editable text — the operator types a number, not '87 KGS'. */}
              <Unit unit={proposedUnit} />
            </span>
            )
          )
        ) : emailCandidate || value ? (
          (() => {
            /*
             * Colour carries the row's state, and the arrow that used to say "differs" is gone — it
             * said the same thing twice. Slate when merely seen: openDecisions strips every conflict
             * the commit settled, so a row that differs is one the committer read and did not write.
             * It is worth SEEING, not worth urging. Green once TAKEN — the same promotion the PO
             * grid's add-tick makes, because at that point it really is going to be written.
             */
            const valueText = (
              <span
                className={cn(
                  'field-value font-mono text-sm leading-snug',
                  taken
                    ? 'font-medium text-status-success'
                    : seenDiffers
                      ? 'text-review-seen'
                      : 'text-text-primary',
                )}
              >
                {emailCandidate?.master ? <MasterCodeChip code={emailCandidate.master.code} /> : null}
                {/* #360: a pick's stored value is the CODE (already on the chip) — show the company
                    name. Numbers group for reading ("1180" → "1,180"); the grouped form is
                    display-only and never seeds the input, since Number() cannot read it back. */}
                {printed(emailCandidate ? emailCandidate.value : value)}
                <Unit unit={proposedUnit} />
                {emailCandidate?.master === null ? <MeshMissTag /> : null}
              </span>
            )
            return (
              <div className="min-w-0 space-y-1">
                {canTake ? (
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={taken}
                      onChange={() => onChange(taken ? existingDisplay : takeValue)}
                      data-testid="conflict-take"
                      aria-label={
                        taken
                          ? `Keep the current ${label} instead of ${emailCandidate!.value}`
                          : `Apply ${emailCandidate!.value} to ${label}`
                      }
                      /* Blue, like every other "the operator chose this" control in these tables: the radio
                         rows below (border-cobalt-primary) and the PO checkboxes. Green here meant
                         nothing — the add/remove tones in ReviewPoStylesSection are semantic, this is
                         the same plain act of taking a value, so it read as a third kind of choice. */
                      className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-cobalt-primary-light"
                    />
                    {valueText}
                  </label>
                ) : (
                  <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5">
                    {valueText}
                  </span>
                )}
                {/* A value nobody offered. It has to be stated separately now that the cell above
                    shows what the EMAIL said — otherwise a typed override would silently
                    masquerade as one. */}
                {/*
                  What will ACTUALLY be written. This shipped at 11px in text-secondary — the
                  smallest, dimmest thing in the row — while the value above it, which is only what
                  the email said and is NOT going to be written, was full size. The type scale was
                  telling the operator the opposite of the truth. It now reads at the row's own value
                  size, in the same green a taken value gets, because that is what it is: the pending
                  write. The label stays quiet so the VALUE is what carries.
                */}
                {overrideValue && (
                  <span data-testid="conflict-override" className="block leading-snug">
                    <span className="text-xs text-text-muted">will write </span>
                    <span className="field-value font-mono text-sm font-medium text-status-success">
                      {printed(overrideValue)}
                    </span>
                  </span>
                )}
              </div>
            )
          })()
        ) : (
          <span className="font-mono text-sm text-text-muted">—</span>
        )}
      </td>
      <td className={cn(REVIEW_COL.reference, REVIEW_TD)}>
        <SourceEmailCell
          candidates={multi && !isPort ? proposed : proposed.slice(0, 1)}
          resolve={resolveSourceEmail}
          editing={editing}
        />
      </td>
    </tr>
  )
}

/**
 * The Reference Email column: one link per PROPOSED candidate, vertically aligned with the value it
 * belongs to. The icon used to sit inline after the value text, where it read as punctuation and
 * operators missed it entirely.
 *
 * Alignment is the whole job here. The proposed cell renders candidates as `<ul className="space-y-1">`
 * with each value in a bordered box, so this mirrors that exact rhythm — same list spacing, same
 * per-row padding and leading — with a transparent border standing in for the value box. Get the
 * metrics wrong and row three's icon points at row two's value, which is worse than no column.
 */
function SourceEmailCell({
  candidates,
  resolve,
  editing,
}: {
  candidates: { value: string; source: string; sourceEmailId?: string | null }[]
  resolve?: ResolveSourceEmail
  editing: boolean
}) {
  const anyResolvable = candidates.some((c) => resolve?.(c.sourceEmailId))
  if (!anyResolvable) {
    // No candidate can be traced — an em dash reads as "nothing to open", where an empty cell
    // reads as "still loading".
    return <span className="font-mono text-sm text-text-muted">—</span>
  }
  return (
    <ul className="space-y-1" aria-label="Source email per proposed candidate">
      {candidates.map((c) => {
        const link = resolve?.(c.sourceEmailId, c.value) ?? null
        return (
          <li key={`${c.sourceEmailId ?? ''}\0${c.source}\0${c.value}`}>
            {/*
              Matches MultiCandidateProposed's box metrics (border + px-2, py-1 editing / py-0.5
              read) so each icon sits on its value's line rather than drifting up the stack.

              A BLOCK box carrying `text-sm leading-snug`, not an inline-flex one. The height then
              comes from the LINE BOX regardless of what sits inside it, giving 28.7px per row — the
              same as the value box. An inline-flex wrapper takes its height from its children
              instead, so a bare 13px icon would render a 25px row and every icon below would creep
              upward off its value. The type ramp, not the glyph, holds the row open.

              The glyph then sits ~1.9px below the row's exact centre, because align-middle centres
              it on the baseline rather than the line box. Left alone deliberately: it is CONSTANT
              (it does not accumulate down the stack) and invisible at 6% of a row. `flex
              items-center` + a min-height looked like the fix and is not — border-box makes min-h
              swallow the padding, collapsing rows to 22.1px and breaking the alignment this whole
              block exists to guarantee.
            */}
            <div
              className={cn(
                'rounded border border-transparent px-2 text-sm leading-snug',
                editing ? 'py-1' : 'py-0.5',
              )}
            >
              {link ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    link.open()
                  }}
                  title={link.title}
                  data-testid="candidate-source-email"
                  className="inline-flex items-center align-middle text-cobalt-primary-light hover:text-cobalt-primary"
                >
                  {/* The document type lives in the tooltip, not on screen — the column is narrow and
                      "Booking Request" beside every row was more noise than signal. aria-label keeps
                      it for screen readers, which have no tooltip. */}
                  <Mail size={13} aria-label={`Open the source email — ${c.source}`} />
                </button>
              ) : (
                // This candidate has no traceable email, but a sibling does — hold the row's height
                // so the icons below stay on their own values.
                <span className="text-text-muted">—</span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Read-only: one style (or PO/style) per line — never a mid-wrap comma blob.
 *  Long lists scroll inside a max-height box so they cannot blow out the review card.
 *  `pairs=false` = per-PO context: a slash is part of the style itself, never a PO prefix. */
export function StyleListDisplay({
  value,
  className,
  pairs = true,
}: {
  value: string
  className?: string
  pairs?: boolean
}) {
  const rows = pairs
    ? parseStyleEntries(value)
    : parseStyleTokens(value).map((style) => ({ po: '', style }))
  // Always set 13px — bare "—" must not inherit body 16px.
  if (rows.length === 0) {
    return <span className="font-mono text-sm text-text-muted">—</span>
  }
  return (
    <div className="min-w-0 max-w-full" data-testid="style-list-display">
      <div className="max-h-40 overflow-y-auto overscroll-contain pr-1">
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li
              key={`${r.po}\0${r.style}`}
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
/** Stable row id for the style editor — content keys remount inputs while typing. */
let styleEditorRowSeq = 0
function nextStyleEditorRowId(): string {
  styleEditorRowSeq += 1
  return `style-row-${styleEditorRowSeq}`
}

type EditorStyleRow = StyleEntry & { rowId: string }

function toEditorRows(entries: StyleEntry[]): EditorStyleRow[] {
  return entries.map((r) => ({ ...r, rowId: nextStyleEditorRowId() }))
}

function emptyEditorRow(): EditorStyleRow {
  return { po: '', style: '', rowId: nextStyleEditorRowId() }
}

export function StyleListEditor({
  label,
  value,
  onChange,
  existingValue,
  pairs = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** System Existing list — used by Copy all (left → right). */
  existingValue?: string
  /** false = per-PO context: tokens only, a slash stays inside the style, no PO# inputs. */
  pairs?: boolean
}) {
  const parse = (v: string | null | undefined): StyleEntry[] =>
    pairs ? parseStyleEntries(v) : parseStyleTokens(v).map((style) => ({ po: '', style }))
  const serialize = (list: StyleEntry[]): string =>
    pairs ? serializeStyleEntries(list) : serializeStyleTokens(list.map((r) => r.style))
  const [rows, setRows] = useState<EditorStyleRow[]>(() => {
    const parsed = parse(value)
    return parsed.length > 0 ? toEditorRows(parsed) : [emptyEditorRow()]
  })
  // Re-seed when the parent value is replaced from outside (e.g. conflict reseed, multi-candidate pick).
  const [seed, setSeed] = useState(value)
  if (seed !== value && serialize(rows) !== value) {
    setSeed(value)
    const parsed = parse(value)
    setRows(parsed.length > 0 ? toEditorRows(parsed) : [emptyEditorRow()])
  }

  const commit = (next: EditorStyleRow[]) => {
    setRows(next)
    onChange(serialize(next))
  }

  const update = (i: number, patch: Partial<StyleEntry>) => {
    commit(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  }

  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i)
    commit(next.length > 0 ? next : [emptyEditorRow()])
  }

  const add = () => commit([...rows, emptyEditorRow()])

  const copyAllFromExisting = () => {
    const parsed = parse(existingValue)
    if (parsed.length === 0) return
    commit(toEditorRows(parsed))
  }

  /** Bulk paste from Excel / comma list replaces the whole Resolution list. */
  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!text || !isMultiStylePaste(text)) return // single token → default paste into the focused input
    const parsed = parse(text)
    if (parsed.length === 0) return
    e.preventDefault()
    commit(toEditorRows(parsed))
  }

  const showPo = pairs && rows.some((r) => r.po.trim())
  const canCopyAll = parse(existingValue).length > 0

  return (
    <div
      className="min-w-0 max-w-full space-y-1.5"
      data-testid="style-list-editor"
      onPaste={handlePaste}
    >
      <div className="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
        {rows.map((r, i) => (
          <div key={r.rowId} className="flex min-w-0 items-center gap-1.5">
            {showPo && (
              <input
                aria-label={`${label} PO ${i + 1}`}
                value={r.po}
                onChange={(e) => update(i, { po: e.target.value })}
                placeholder="PO#"
                className="h-8 w-[30%] min-w-[5rem] shrink-0 rounded-lg border border-border bg-surface-900 px-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
              />
            )}
            <input
              aria-label={
                rows.length === 1 ? `Proposed value for ${label}` : `${label} style ${i + 1}`
              }
              value={r.style}
              onChange={(e) => update(i, { style: e.target.value })}
              placeholder="Style / item no. — or paste a list"
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
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
 * Every non-system candidate, pickable where it is shown.
 *
 * This used to render twice: inert `<div>`s plus the footnote "N candidates — pick one in Edit", and
 * a radio group once the card was in edit mode. The radios and their onChange were identical in both
 * — the mode switch was the only thing between the operator and the answer, so choosing a vendor took
 * three steps (Edit → pick → Submit) for a decision that was already fully described on screen.
 *
 * Now the pick is gated on `canEdit` (may this operator resolve at all) rather than on `editing`
 * (is the multi-field editor open). Resolved history still renders inert. Free-typing a value the
 * agent never proposed is the one thing that still needs the editor, so that is what the in-cell
 * link opens.
 */
function MultiCandidateProposed({
  conflict,
  label,
  proposed,
  value,
  keepValue,
  keepLabel,
  onChange,
  editing,
  canEdit,
  onRequestEdit,
  proposedUnit,
}: {
  conflict: CriticConflict
  label: string
  proposed: CriticCandidate[]
  value: string
  /** The row's default resolution — what the leg stores ('' when it stores nothing). */
  keepValue: string
  /** `keepValue` as this row prints it (numbers grouped, dates without their `T`). */
  keepLabel: string
  onChange: (v: string) => void
  editing: boolean
  /** Operator may resolve this row at all (Active queue). False on Approved/Rejected history. */
  canEdit: boolean
  /** Opens the multi-field editor — the only way to type a value the agent never proposed. */
  onRequestEdit?: () => void
  proposedUnit?: string | null
}) {
  const groupName = `candidates-${label.replace(/\s+/g, '-').toLowerCase()}`
  const keepSelected = resolutionForm(conflict.field, value) === keepValue

  return (
    <div className="space-y-1.5" data-testid="multi-candidate-proposed">
      <ul
        role={canEdit ? 'radiogroup' : 'list'}
        aria-label={`AI proposed candidates for ${label}`}
        className="space-y-1"
      >
        {/*
          The way back. A radio cannot be un-picked, so once the operator touched any candidate the
          row had no route to "actually, leave it alone" short of reloading the card — and the row
          now OPENS on that answer, so it needs to be an option in the group rather than an implicit
          state outside it. First, because it is the default; only where a decision can be made.
        */}
        {canEdit && (
          <li>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded border px-2 py-1 text-xs transition-colors',
                keepSelected
                  ? 'border-cobalt-primary bg-cobalt-primary/10'
                  : 'border-border bg-surface-900 hover:bg-surface-700',
              )}
            >
              <input
                type="radio"
                name={groupName}
                className="mt-0.5 shrink-0"
                checked={keepSelected}
                onChange={() => onChange(keepValue)}
                data-testid="conflict-keep-current"
                aria-label={
                  keepValue === ''
                    ? `Leave ${label} blank`
                    : `Keep the current ${label}: ${keepLabel}`
                }
              />
              <span className="min-w-0 text-sm leading-snug text-text-secondary">
                {keepValue === '' ? (
                  'Leave blank'
                ) : (
                  <>
                    Keep current —{' '}
                    <span className="field-value font-mono text-text-primary">{keepLabel}</span>
                  </>
                )}
              </span>
            </label>
          </li>
        )}
        {proposed.map((c) => {
          // #360: a pick is stored as the candidate's resolution value (master CODE when resolved)
          const selected = candidateMatches(conflict, c, value)
          return (
            <li key={`${c.sourceEmailId ?? ''}\0${c.source}\0${c.value}`}>
              {canEdit ? (
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
                    checked={selected}
                    onChange={() => onChange(takeValueOf(conflict, c))}
                    aria-label={`Select proposed candidate: ${c.value}`}
                  />
                  <span className="field-value font-mono text-sm leading-snug text-text-primary">
                    {c.master ? <MasterCodeChip code={c.master.code} /> : null}
                    {c.value}
                    <Unit unit={proposedUnit} />
                    {c.master === null ? <MeshMissTag /> : null}
                  </span>
                </label>
              ) : (
                /* Inert = resolved history, or a field with no leg column to write. Either way the
                   resolution is still the STORED value, so "this one is a pending change" cannot be
                   true here — the seen-differs styling this branch used to carry was unreachable
                   once the seed stopped being the agent's proposal. Selected means only "this is
                   the value the leg holds". */
                <div
                  className={cn(
                    'inline-flex max-w-full rounded border px-2 py-0.5',
                    selected ? 'border-border bg-surface-900/50' : 'border-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'field-value font-mono text-sm leading-snug',
                      selected ? 'text-text-primary' : 'text-text-secondary',
                    )}
                  >
                    {c.master ? <MasterCodeChip code={c.master.code} /> : null}
                    {c.value}
                    <Unit unit={proposedUnit} />
                    {c.master === null ? <MeshMissTag /> : null}
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
              /* #360: blank while any radio above is active — pre-filling the company full name here
                 read as "this is what will be written". Typing switches to a custom value. Keeping
                 the current value counts: its radio says so, and echoing it in the override box
                 would show the same answer twice in two different grammars. */
              value={
                keepSelected || proposed.some((c) => candidateMatches(conflict, c, value)) ? '' : value
              }
              onChange={(e) => onChange(e.target.value)}
              placeholder="—"
              className="h-8 w-full rounded-lg border border-border bg-surface-900 px-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none"
            />
            <Unit unit={proposedUnit} />
          </span>
        </div>
      )}
      {/* Replaces "N candidates — pick one in Edit". The count was only ever there to explain why the
          rows looked dead; they are live now, so all that is left to offer is the one thing they
          cannot do. */}
      {!editing && canEdit && onRequestEdit && (
        <button
          type="button"
          onClick={onRequestEdit}
          data-testid="candidate-type-custom"
          className="text-[11px] font-medium text-cobalt-primary-light hover:underline"
        >
          Type a different value
        </button>
      )}
    </div>
  )
}
