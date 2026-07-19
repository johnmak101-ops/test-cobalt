import type { CriticalColumn, CriticalItem } from '../../lib/review-critical'
import { fieldLabel, toInputValue } from '../../lib/review-fields'
import { REVIEW_FS } from './review-table-layout'

const DATE_COLUMNS = new Set<CriticalColumn>(['cargoReadyDate', 'etd', 'atd'])

const inputCls =
  'mt-1 w-full min-w-0 rounded-md border border-border bg-surface-700 px-2 py-1 text-[13px] text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

function isDateColumn(column: CriticalColumn): boolean {
  return DATE_COLUMNS.has(column)
}

/** Seed draft for <input type="date"> — YYYY-MM-DD only. */
function dateInputValue(raw: string | undefined): string {
  if (raw == null || raw === '') return ''
  // toInputValue date form is local datetime-local; type=date wants date-only
  const seeded = toInputValue(raw, 'date')
  return seeded.slice(0, 10)
}

/** Short label for the open-item subtitle (matches ops jargon on the card). */
function shortLabel(item: CriticalItem): string {
  switch (item.column) {
    case 'bookingNo':
      return 'Booking'
    case 'soNo':
      return 'SO'
    case 'cargoReadyDate':
      return 'CRD'
    case 'etd':
      return 'ETD'
    case 'atd':
      return 'ATD'
    default:
      return item.label || fieldLabel(item.column)
  }
}

/**
 * Decision-desk band: missing / contested Booking · SO · CRD · ETD · ATD.
 * Type scale: title (14) > row label (12 semibold) > value (12 muted) > caption (10).
 * Layout: compact single-line rows in a 1–2 col grid so two items do not leave a sparse void.
 */
export function CriticalSailingBand({
  items,
  editing,
  drafts,
  onDraftChange,
}: {
  items: CriticalItem[]
  editing: boolean
  drafts: Partial<Record<CriticalColumn, string>>
  onDraftChange: (column: CriticalColumn, value: string) => void
}): JSX.Element | null {
  if (items.length === 0) return null

  const openShort = items.map(shortLabel).join(' · ')

  return (
    <div
      data-testid="critical-sailing"
      className="rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2.5"
    >
      {/* Title row */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className={`${REVIEW_FS.title} font-semibold text-status-warning`}>
          Critical for sailing
        </h3>
        <span className={`${REVIEW_FS.meta} font-medium tabular-nums text-text-muted`}>
          ({items.length})
        </span>
      </div>

      {/* Only the open fields — not the full five-field legend */}
      <p className={`mt-0.5 ${REVIEW_FS.meta} text-text-muted`}>
        {openShort}
        <span className="text-text-muted/80"> — missing or contested</span>
      </p>

      <ul
        className={
          items.length > 1
            ? 'mt-2 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2'
            : 'mt-2 space-y-1.5'
        }
      >
        {items.map((item) => {
          const name = item.label || fieldLabel(item.column)
          const key =
            item.kind === 'conflict' ? `conflict:${item.field}` : `missing:${item.column}`

          return (
            <li key={key} className="flex min-w-0 items-start gap-2">
              <span
                className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                {item.kind === 'missing' ? (
                  editing ? (
                    <div>
                      <span className={`${REVIEW_FS.label} font-medium text-text-primary`}>
                        {name}
                      </span>
                      {isDateColumn(item.column) ? (
                        <input
                          type="date"
                          className={inputCls}
                          aria-label={name}
                          value={dateInputValue(drafts[item.column])}
                          onChange={(e) => onDraftChange(item.column, e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          className={inputCls}
                          aria-label={name}
                          value={drafts[item.column] ?? ''}
                          onChange={(e) => onDraftChange(item.column, e.target.value)}
                        />
                      )}
                    </div>
                  ) : (
                    /* Single line: Label · Not set — denser than stacked blocks */
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
                      <span className={`${REVIEW_FS.label} font-semibold text-text-primary`}>
                        {name}
                      </span>
                      <span className={`${REVIEW_FS.label} text-text-muted`}>Not set</span>
                    </p>
                  )
                ) : (
                  <div className="min-w-0">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0">
                      <span className={`${REVIEW_FS.label} font-semibold text-text-primary`}>
                        {name}
                      </span>
                      <span
                        className={`field-value font-mono ${REVIEW_FS.label} text-text-secondary`}
                      >
                        {item.summary}
                      </span>
                    </p>
                    <p className={`mt-0.5 ${REVIEW_FS.caption} text-text-muted`}>
                      Resolve in field conflicts below
                    </p>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
