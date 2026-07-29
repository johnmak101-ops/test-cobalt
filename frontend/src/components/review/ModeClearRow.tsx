/**
 * A field this Apply will EMPTY, as a row in the decision grid.
 *
 * Taking a different Mode reclassifies the leg, and the old mode's transport fields go with it — a
 * sea shipment cannot hold an air waybill. That consequence used to live in its own amber panel
 * BELOW the grid, on the reasoning that the Mode row's cell is the decision and a second set of ticks
 * inside it would mix two kinds of choice. True of the cell; wrong about the table. The deletions are
 * writes this button performs, the grid is the list of writes this button performs, and keeping them
 * out of it meant the operator read the table, believed they had seen the change set, and pressed a
 * button that also emptied two fields named somewhere else.
 *
 * So they are rows. Same four columns as every other row — what it is, what it holds, what happens,
 * where it came from — and the row is filed under the section that OWNS the field, not the section
 * that owns Mode: taking Mode (Shipping) clears MAWB, which belongs to Cargo & Logistics and appears
 * there. The reference cell is what ties them back together.
 *
 * The current value is struck through, never removed. Nothing should vanish from under the operator
 * before they save.
 */
import { cn } from '../../lib/utils'
import { REVIEW_COL, REVIEW_TD } from './review-table-layout'

export interface ModeClearRowProps {
  /** Leg column being cleared — 'mawb', 'mbl', 'vesselName', 'voyageNo', 'flightNo'. */
  column: string
  /** Display label from the shared field vocabulary (EDITABLE_FIELDS), never the raw column. */
  label: string
  /** What the leg stores today. Shown struck through while ticked — shown either way. */
  value: string
  /** The mode being taken. It is what makes this field inapplicable, so it is named in the reason. */
  takingMode: string
  /** Ticked = this Apply clears the field. Default is ticked; see the card's keepOnModeSwitch. */
  clearing: boolean
  onToggle: () => void
}

export function ModeClearRow({
  column,
  label,
  value,
  takingMode,
  clearing,
  onToggle,
}: ModeClearRowProps) {
  return (
    <tr
      className="border-b border-border align-top last:border-0"
      data-testid={`mode-clear-row-${column}`}
    >
      <td
        className={cn(
          REVIEW_COL.label,
          REVIEW_TD,
          'font-semibold',
          clearing ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        {label}
      </td>
      <td className={cn(REVIEW_COL.existing, REVIEW_TD)}>
        <span
          className={cn(
            'field-value font-mono',
            clearing
              ? 'text-text-muted line-through decoration-remove decoration-[1.5px]'
              : 'text-text-primary',
          )}
        >
          {value}
        </span>
      </td>
      <td className={cn(REVIEW_COL.proposed, REVIEW_TD)}>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={clearing}
            onChange={onToggle}
            /* Unchanged from the panel this replaced: the tick is the same decision, and the desk's
               tests and any muscle memory should not care that it moved into the grid. */
            data-testid={`mode-carry-over-${column}`}
            aria-label={`Clear ${label} when taking ${takingMode}`}
            className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-border accent-remove-fill"
          />
          <span className="min-w-0">
            <span
              className={cn('block font-medium', clearing ? 'text-remove' : 'text-text-muted')}
            >
              {clearing ? 'Delete it' : 'Keeping it'}
            </span>
            {/* States the rule, not this leg's story — so the sentence still reads correctly in the
                change history, an audit trail or an export, where neither the Mode row above nor the
                Field column beside it travels with the text. */}
            <span className="mt-0.5 block text-[11px] text-text-muted">
              {label} is not applicable for {takingMode} mode
            </span>
          </span>
        </label>
      </td>
      <td className={cn(REVIEW_COL.reference, REVIEW_TD, 'text-[11px] text-text-muted')}>
        comes with the Mode row
      </td>
    </tr>
  )
}
