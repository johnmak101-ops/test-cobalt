/**
 * "PO N is on 2 shipments" — the two shipments in one table, and the answers under it.
 *
 * Three rounds of desk feedback shaped this, and each one removed something:
 *
 * 1. The original was a REFERENCE — it named the other leg, printed both quantities and stopped, on
 *    the reasoning that a cross-mode split and a mis-link are indistinguishable from here so only a
 *    human can tell them apart. That reasoning holds; the conclusion drawn from it ("state facts,
 *    offer nothing") did not. An operator who decided the link was WRONG had no click that said so,
 *    so the honest move was `Waiting`, and the leg parked again next time.
 * 2. The reply-with-answers version then carried a heading AND an explanation ("Usually that means
 *    the order was split…"). Both went: the heading restated the card's own question, and the desk
 *    speaks to forwarders every day — it does not need to be told what a split is.
 * 3. Radios alone were still too narrow. What the operator actually wants first is often to CORRECT
 *    the line — the PO number the parser read, the quantity, the unit — and then say it belongs. So
 *    this leg's row is editable in place, and "keep it, with the corrections I typed above" is the
 *    third answer.
 *
 * What survives from the first version: it proposes no verdict. Nothing is preselected, `crossMode`
 * reports that two legs record different modes without concluding what that means, and where the two
 * quantities cannot honestly be compared the panel says so rather than asking for the comparison.
 */
import { ArrowUpRight, ArrowsUpFromLine } from 'lucide-react'
import type { SharedPo, SharedPoLeg } from '../../hooks/use-shipments'
import { isUsableIdentifier } from '../../lib/identifier-shape'
import { formatShipmentId } from '../../lib/utils'
import { ReviewBlock } from './ReviewBlock'
import { cn } from '../../lib/utils'

/** What the operator decided about one shared PO. Recorded by the card, written on its primary button. */
export type SharedPoAnswer = 'split' | 'remove' | 'correct'

/** The line as the operator wants it stored — blank string means "unchanged". */
export type SharedPoEdit = { poNumber?: string; qty?: string; qtyUnit?: string }

/**
 * A leg is NAMED by its derived Shipment ID — the same string the queue's "Shipment ID" column, the
 * detail page title and the focus page all print. This panel used to label siblings by booking
 * number, which re-created the "same leg answers to two different names depending on the screen"
 * problem #350 removed from the focus page.
 */
function legName(leg: SharedPoLeg): string {
  return formatShipmentId(leg.shipmentId, leg.idAnchorAt)
}

/**
 * The carrier-side reference, for matching against a forwarder's mail. Skipped when digit-free: a leg
 * whose booking number is `PO # :` was parsed from a spreadsheet header, and printing that asks the
 * operator to go looking for "PO # :".
 */
function legRef(leg: SharedPoLeg): string | null {
  return (
    [leg.bookingNo, leg.soNo, leg.hblAwbFcrNo]
      .map((v) => String(v ?? '').trim())
      .find((v) => isUsableIdentifier(v)) ?? null
  )
}

const dateLabel = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null)

/** ATD once it has left, else ETD — one date per row, in the column the header names. */
function departed(etd: string | null | undefined, atd: string | null | undefined): string | null {
  return dateLabel(atd) ?? dateLabel(etd)
}

const unitOf = (u: string | null): string => String(u ?? '').trim().toLowerCase()

/**
 * Can the two quantities be read against each other at all?
 *
 * On PO 1570988 the old copy said "check the quantities", which asked the operator to weigh 26 pieces
 * against 207 cartons. Those are not the same measure and no amount of looking makes them one. So the
 * panel names which of the three situations it is in, and only does arithmetic in the one where
 * arithmetic is true.
 */
export function quantityNote(group: SharedPo): string | null {
  const mine = group.legQty
  const theirs = group.others.map((o) => o.legQty)
  if (mine == null || theirs.some((q) => q == null)) {
    return 'One shipment has no quantity recorded — the two cannot be compared.'
  }
  const units = new Set([unitOf(group.legQtyUnit), ...group.others.map((o) => unitOf(o.legQtyUnit))])
  if (units.size > 1) {
    const named = [...units].filter((u) => u !== '')
    return `Counted differently${
      named.length > 1 ? ` (${named.join(' and ')})` : ''
    } — the two cannot be added up.`
  }
  const unit = group.legQtyUnit?.trim()
  const total = (mine ?? 0) + theirs.reduce<number>((sum, q) => sum + (q ?? 0), 0)
  return `${total.toLocaleString()}${unit ? ` ${unit}` : ''} across both shipments.`
}

/** Units the desk actually books in. The stored value joins the list when it is something else, so an
 *  edit never silently rewrites a unit the parser read off a document. */
const UNITS = ['pieces', 'cartons', 'sets', 'pairs', 'kgs', 'cbm'] as const

/**
 * Column widths CAPPED to what each column actually holds.
 *
 * Two passes got this wrong in opposite directions. `1fr` everywhere gave `mode` (three letters) the
 * same room as `shipment` (a 10-character id plus a link arrow). Weighted `fr` fixed the ratio but
 * not the total: on a 910px card the flexible columns still stretched to fill it, so a 7-digit PO
 * number sat in a 195px cell and the row read as six widely-spaced islands rather than a table.
 *
 * So every track is `minmax(floor, ceiling)` in px. The table is now as wide as its contents need
 * and no wider — about 600px — and the space left over stays empty, which is what lets the eye run
 * down a column. `min-w-0` on the cells keeps a long shipment id truncating instead of pushing the
 * grid past the card.
 */
const GRID =
  'grid grid-cols-[minmax(118px,136px)_44px_minmax(96px,112px)_72px_minmax(92px,104px)_88px] items-center gap-2'
const CELL = 'min-w-0 truncate text-sm leading-snug'
const INPUT =
  'h-7 w-full min-w-0 rounded-md border border-border bg-surface-800 px-1.5 font-mono text-[13px] text-text-primary focus:border-cobalt-primary focus:outline-none disabled:opacity-60'

export interface SharedPoPanelProps {
  sharedPos: SharedPo[]
  /** This leg's mode / schedule, so its row is a row and not a footnote on the other one. */
  mode?: string | null
  etd?: string | null
  atd?: string | null
  answers?: Record<string, SharedPoAnswer>
  onAnswer?: (poNumber: string, answer: SharedPoAnswer) => void
  /** Typed corrections to THIS leg's line, keyed by the PO number as it stands now. */
  edits?: Record<string, SharedPoEdit>
  onEdit?: (poNumber: string, patch: SharedPoEdit) => void
  /**
   * PO numbers this card can take off the shipment (the link row is known). "Remove" is withheld for
   * the rest: a choice whose write cannot happen is the same dead end one level deeper.
   */
  removable?: Record<string, boolean>
  readOnly?: boolean
}

export function SharedPoPanel({
  sharedPos,
  mode,
  etd,
  atd,
  answers,
  onAnswer,
  edits,
  onEdit,
  removable,
  readOnly = false,
}: SharedPoPanelProps) {
  const groups = sharedPos.filter((g) => g.others.length > 0)
  if (groups.length === 0) return null

  const answerable = !readOnly && onAnswer != null
  const myMode = (mode ?? '').trim()
  const myDate = departed(etd, atd)

  return (
    <div className="space-y-2" data-testid="shared-po-list">
      {groups.map((g) => {
        const answer = answers?.[g.poNumber]
        const edit = edits?.[g.poNumber] ?? {}
        const canRemove = removable?.[g.poNumber] !== false
        const canEdit = !readOnly && onEdit != null
        const note = quantityNote(g)
        const choices: Array<{ key: SharedPoAnswer; label: string }> = [
          { key: 'split', label: 'Split — both shipments are correct' },
          ...(canRemove
            ? [
                {
                  key: 'remove' as const,
                  label: `Not on this shipment — take PO ${g.poNumber} off`,
                },
              ]
            : []),
          ...(canEdit
            ? [{ key: 'correct' as const, label: 'Keep it, with the corrections I typed above' }]
            : []),
        ]

        return (
          <ReviewBlock
            key={g.poNumber}
            title={`PO ${g.poNumber} is on ${g.others.length + 1} shipments`}
            icon={ArrowsUpFromLine}
            status={answerable ? 'answer' : 'none'}
            data-testid={`shared-po-${g.poNumber}`}
          >
            {/* The tracks are px-capped, so on a narrow card they stop shrinking and the `departed`
                column simply left the box — 134px past its right edge on a tablet, silently, because
                nothing in the chain scrolls. The table scrolls sideways instead of being cut. */}
            <div className="-mx-1 overflow-x-auto px-1">
            <div className={cn(GRID, 'w-max min-w-full pb-1 text-xs text-text-muted')}>
              <span>shipment</span>
              <span>mode</span>
              <span>PO</span>
              <span>qty</span>
              <span>uom</span>
              <span>departed</span>
            </div>

            {/* THIS leg, editable. The parser's reading of a PO number, a quantity or a unit is the
                thing most often wrong on these cards, and until now the only way to change it was to
                leave the desk for the shipment page. */}
            <div className={cn(GRID, 'w-max min-w-full py-0.5')} data-testid={`shared-po-self-${g.poNumber}`}>
              {/* "this one" read as a pointer with nothing to point at. The row IS the shipment the
                  operator has open, so it says so. */}
              <span className={cn(CELL, 'text-text-secondary')}>current shipment</span>
              <span className={cn(CELL, 'font-mono text-status-warning')}>
                {myMode ? myMode.toUpperCase() : '—'}
              </span>
              {canEdit ? (
                <input
                  className={INPUT}
                  value={edit.poNumber ?? g.poNumber}
                  onChange={(e) => onEdit!(g.poNumber, { poNumber: e.target.value })}
                  aria-label={`PO number on this shipment (now ${g.poNumber})`}
                />
              ) : (
                <span className={cn(CELL, 'font-mono text-text-primary')}>{g.poNumber}</span>
              )}
              {canEdit ? (
                <input
                  className={INPUT}
                  inputMode="numeric"
                  value={edit.qty ?? (g.legQty == null ? '' : String(g.legQty))}
                  onChange={(e) => onEdit!(g.poNumber, { qty: e.target.value })}
                  aria-label={`Quantity on this shipment for PO ${g.poNumber}`}
                />
              ) : (
                <span className={cn(CELL, 'font-mono text-text-primary')}>
                  {g.legQty?.toLocaleString() ?? '—'}
                </span>
              )}
              {canEdit ? (
                <select
                  className={cn(INPUT, 'font-sans')}
                  value={edit.qtyUnit ?? g.legQtyUnit ?? ''}
                  onChange={(e) => onEdit!(g.poNumber, { qtyUnit: e.target.value })}
                  aria-label={`Unit on this shipment for PO ${g.poNumber}`}
                >
                  <option value="">—</option>
                  {/* The stored unit joins the list when it is not one of ours, so opening the picker
                      can never quietly drop what the document actually said. */}
                  {[
                    ...new Set(
                      [...UNITS, (g.legQtyUnit ?? '').trim().toLowerCase()].filter((u) => u !== ''),
                    ),
                  ].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={cn(CELL, 'text-text-primary')}>{g.legQtyUnit ?? '—'}</span>
              )}
              <span className={cn(CELL, 'text-text-muted')}>{myDate ?? '—'}</span>
            </div>

            {g.others.map((leg) => (
              <div
                key={leg.shipmentId}
                className={cn(GRID, 'w-max min-w-full border-t border-border py-1')}
                data-testid={`shared-po-other-${leg.shipmentId}`}
              >
                {/* The carrier reference rides the WRAPPER's tooltip, not the link's. On the anchor
                    it displaced the link's own text in the accessibility name, so the row announced
                    itself as "S2600144827" while every screen calls that leg 202604EC10. */}
                <span className="min-w-0" title={legRef(leg) ?? undefined}>
                  <a
                    href={`/shipments/${leg.shipmentId}`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      CELL,
                      'inline-flex min-w-0 items-center gap-1 truncate font-mono text-cobalt-primary-light hover:underline',
                    )}
                    data-testid={`shared-po-open-${leg.shipmentId}`}
                  >
                    {legName(leg)}
                    <ArrowUpRight size={12} className="shrink-0" />
                  </a>
                </span>
                <span
                  className={cn(
                    CELL,
                    'font-mono',
                    leg.crossMode ? 'text-status-warning' : 'text-text-secondary',
                  )}
                >
                  {leg.mode ? leg.mode.toUpperCase() : '—'}
                </span>
                <span className={cn(CELL, 'font-mono text-text-secondary')}>{g.poNumber}</span>
                <span className={cn(CELL, 'font-mono text-text-secondary')}>
                  {leg.legQty?.toLocaleString() ?? '—'}
                </span>
                <span className={cn(CELL, 'text-text-secondary')}>{leg.legQtyUnit ?? '—'}</span>
                <span className={cn(CELL, 'text-text-muted')}>
                  {departed(leg.etd, leg.atd) ?? '—'}
                  {/* State matters for the verdict: you do not move a PO off a shipment that has
                      sailed, and a rejected one is not a competing claim. */}
                  {leg.dismissed && <span className="block text-xs">rejected</span>}
                  {!leg.dismissed && leg.provisional && (
                    <span className="block text-xs">in review</span>
                  )}
                </span>
              </div>
            ))}
            </div>

            {note && (
              <p
                className="mt-1.5 text-xs text-text-muted"
                data-testid={`shared-po-qty-note-${g.poNumber}`}
              >
                {note}
              </p>
            )}

            {answerable && (
              <div
                className="mt-2 grid gap-1"
                role="radiogroup"
                aria-label={`What to do about PO ${g.poNumber}`}
              >
                {choices.map((c) => (
                  <label
                    key={c.key}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors',
                      answer === c.key
                        ? 'border-cobalt-primary bg-cobalt-primary/10'
                        : 'border-border bg-surface-800 hover:bg-surface-700',
                    )}
                    data-testid={`shared-po-answer-${c.key}-${g.poNumber}`}
                  >
                    <input
                      type="radio"
                      name={`shared-po-${g.poNumber}`}
                      className="h-4 w-4 shrink-0"
                      checked={answer === c.key}
                      onChange={() => onAnswer!(g.poNumber, c.key)}
                      /* Named explicitly: the wrapping label is a flex row and what came out of the
                         accessibility tree without this was "radio, on". */
                      aria-label={`PO ${g.poNumber} — ${c.label}`}
                    />
                    <span className="min-w-0 text-text-primary">{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </ReviewBlock>
        )
      })}
    </div>
  )
}
