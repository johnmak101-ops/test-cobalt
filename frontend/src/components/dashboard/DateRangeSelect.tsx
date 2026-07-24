import { cn } from '../../lib/utils'

/**
 * Date-range control: presets plus an optional explicit from/to.
 *
 * `null` on either bound means "unbounded that side", which is what makes All work without a
 * special case — every filter is the same `from <= d <= to` test with the missing side skipped.
 */
export interface DateRange {
  from: string | null
  to: string | null
}

export const ALL_TIME: DateRange = { from: null, to: null }

/** Days back from today, inclusive of today. `null` days = All time. */
const PRESETS: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
]

/** yyyy-mm-dd for `d`, in LOCAL time — the operator reads dates in their own day, not UTC's. */
function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function rangeForDays(days: number | null, now: Date = new Date()): DateRange {
  if (days == null) return ALL_TIME
  const from = new Date(now)
  from.setDate(from.getDate() - (days - 1))
  return { from: isoDay(from), to: isoDay(now) }
}

/**
 * Is `value` inside the range? Compares CALENDAR DAYS as strings, never Date objects: the stored
 * value is an ISO timestamp, so a `new Date()` compare would push a 23:00 local ETD into the next
 * UTC day and drop it from a range whose last day is today.
 */
export function inRange(value: string | null | undefined, range: DateRange): boolean {
  if (!range.from && !range.to) return true
  if (!value) return false
  const day = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

/** Which preset (if any) the current range equals — so the chip stays lit after a re-render. */
function activePreset(range: DateRange, now: Date = new Date()): string | null {
  for (const p of PRESETS) {
    const r = rangeForDays(p.days, now)
    if (r.from === range.from && r.to === range.to) return p.label
  }
  return null
}

export function DateRangeSelect({
  value,
  onChange,
  label,
}: {
  value: DateRange
  onChange: (r: DateRange) => void
  /** What the range filters on, e.g. "ETD" — aria-only since 2026-07-24 (ops: the visible tag
   *  read as noise beside the presets); screen readers still hear "ETD from / ETD to". */
  label: string
}) {
  const active = activePreset(value)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(rangeForDays(p.days))}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              active === p.label
                ? 'bg-cobalt-primary text-white'
                : 'text-text-muted hover:bg-surface-700 hover:text-text-primary',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="date"
          aria-label={`${label} from`}
          value={value.from ?? ''}
          onChange={(e) => onChange({ ...value, from: e.target.value || null })}
          className="h-7 rounded-md border border-border bg-surface-900 px-2 text-xs text-text-primary focus:border-cobalt-primary focus:outline-none"
        />
        <span className="text-xs text-text-muted">→</span>
        <input
          type="date"
          aria-label={`${label} to`}
          value={value.to ?? ''}
          onChange={(e) => onChange({ ...value, to: e.target.value || null })}
          className="h-7 rounded-md border border-border bg-surface-900 px-2 text-xs text-text-primary focus:border-cobalt-primary focus:outline-none"
        />
      </div>
    </div>
  )
}
