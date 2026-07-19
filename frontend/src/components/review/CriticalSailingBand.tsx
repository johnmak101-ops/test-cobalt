import type { CriticalColumn, CriticalItem } from '../../lib/review-critical'
import { fieldLabel, toInputValue } from '../../lib/review-fields'
import {
  REVIEW_FS,
  REVIEW_PANEL_CRITICAL,
  REVIEW_PANEL_DOT,
  REVIEW_PANEL_ITEM,
  REVIEW_PANEL_LIST,
} from './review-table-layout'
import { cn } from '../../lib/utils'

const DATE_COLUMNS = new Set<CriticalColumn>(['cargoReadyDate', 'etd', 'atd'])

const inputCls =
  'mt-1 w-full min-w-0 max-w-md rounded-md border border-border bg-surface-700 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

function isDateColumn(column: CriticalColumn): boolean {
  return DATE_COLUMNS.has(column)
}

/** Seed draft for <input type="date"> — YYYY-MM-DD only. */
function dateInputValue(raw: string | undefined): string {
  if (raw == null || raw === '') return ''
  const seeded = toInputValue(raw, 'date')
  return seeded.slice(0, 10)
}

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
 * Same list layout as Needs attention (single column, shared left edge) — not a sparse 2-col grid.
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
    <div data-testid="critical-sailing" className={REVIEW_PANEL_CRITICAL}>
      {/* Same header stack as Needs attention: kicker → group/title → list */}
      <p className={`${REVIEW_FS.meta} font-medium text-status-warning`}>
        Critical for sailing
        <span className="ml-1.5 font-medium tabular-nums text-text-muted">({items.length})</span>
      </p>
      <p className={`mt-0.5 ${REVIEW_FS.meta} text-text-muted`}>
        {openShort}
        <span> — missing or contested</span>
      </p>

      <ul className={REVIEW_PANEL_LIST}>
        {items.map((item) => {
          const name = item.label || fieldLabel(item.column)
          const key =
            item.kind === 'conflict' ? `conflict:${item.field}` : `missing:${item.column}`

          return (
            <li key={key} className={REVIEW_PANEL_ITEM}>
              <span className={cn(REVIEW_PANEL_DOT, 'bg-status-warning')} aria-hidden />
              <div className="min-w-0 flex-1">
                {item.kind === 'missing' ? (
                  editing ? (
                    <div>
                      <span className={`${REVIEW_FS.label} font-semibold text-text-primary`}>
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
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className={`${REVIEW_FS.label} font-semibold text-text-primary`}>
                        {name}
                      </span>
                      <span className={`${REVIEW_FS.label} text-text-muted`}>Not set</span>
                    </p>
                  )
                ) : (
                  <div className="min-w-0">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
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
