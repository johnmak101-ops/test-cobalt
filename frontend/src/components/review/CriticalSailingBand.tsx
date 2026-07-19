import type { CriticalColumn, CriticalItem } from '../../lib/review-critical'
import { fieldLabel, toInputValue } from '../../lib/review-fields'

const DATE_COLUMNS = new Set<CriticalColumn>(['cargoReadyDate', 'etd', 'atd'])

const inputCls =
  'mt-0.5 w-full min-w-0 max-w-xs rounded-md border border-border bg-surface-700 px-2 py-1 text-sm text-text-primary placeholder:text-text-muted focus:border-cobalt-primary focus:outline-none'

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

  return (
    <div
      data-testid="critical-sailing"
      className="rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-2"
    >
      <p className="text-[11px] font-medium text-status-warning">
        Critical for sailing
        <span className="ml-1 font-normal text-text-muted">({items.length})</span>
      </p>
      <p className="mt-0.5 text-[10px] text-text-muted">
        Booking, SO, CRD, ETD, ATD — missing or contested
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item) => {
          const name = item.label || fieldLabel(item.column)
          return (
            <li
              key={item.kind === 'conflict' ? `conflict:${item.field}` : `missing:${item.column}`}
              className="flex items-start gap-1.5 text-xs text-text-secondary"
            >
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-status-warning" />
              <div className="min-w-0 flex-1">
                <span className="font-medium text-text-primary">{name}</span>
                {item.kind === 'missing' ? (
                  editing ? (
                    isDateColumn(item.column) ? (
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
                    )
                  ) : (
                    <p className="text-text-muted">Not set</p>
                  )
                ) : (
                  <div>
                    <p className="font-mono text-text-secondary">{item.summary}</p>
                    <p className="text-[10px] text-text-muted">Resolve in field conflicts below</p>
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
