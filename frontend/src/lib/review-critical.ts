/**
 * Critical sailing fields for the Review Decision Desk.
 * Fixed allowlist: Booking, SO#, CRD, ETD, ATD — missing or contested → work.
 */
import { EDITABLE_FIELDS, fieldLabel, mapCriticFieldToColumn } from './review-fields'

export const CRITICAL_COLUMNS = [
  'bookingNo',
  'soNo',
  'cargoReadyDate',
  'etd',
  'atd',
] as const
export type CriticalColumn = (typeof CRITICAL_COLUMNS)[number]

export type CriticalItem =
  | { kind: 'missing'; column: CriticalColumn; label: string }
  | {
      kind: 'conflict'
      column: CriticalColumn
      label: string
      field: string // critic conflict.field for scroll/key
      summary: string // short "system vs AI" line
    }

const CRITICAL_SET = new Set<string>(CRITICAL_COLUMNS)

/**
 * Critic conflict.field aliases that mapCriticFieldToColumn may miss (uiKey / snake variants).
 * Keep local so criticalConflicts stays correct without expanding the global correct-DTO map.
 */
const CONFLICT_FIELD_TO_CRITICAL: Record<string, CriticalColumn> = {
  booking_no: 'bookingNo',
  bookingNo: 'bookingNo',
  so_no: 'soNo',
  soNo: 'soNo',
  soNumber: 'soNo',
  crd: 'cargoReadyDate',
  cargo_ready_date: 'cargoReadyDate',
  cargoReadyDate: 'cargoReadyDate',
  etd: 'etd',
  atd: 'atd',
  actual_departure: 'atd',
  actualDeparture: 'atd',
}

/**
 * Live property names that may hold a critical column value on queue-shaped or detail-shaped
 * shipment objects (uiKey + common aliases). Order = first hit wins.
 */
const LIVE_KEYS: Record<CriticalColumn, readonly string[]> = {
  bookingNo: ['bookingNo'],
  soNo: ['soNumber', 'soNo'],
  cargoReadyDate: ['crd', 'cargoReadyDate'],
  etd: ['etd'],
  atd: ['actualDeparture', 'atd'],
}

function resolveCriticalColumn(field: string): CriticalColumn | null {
  if (!field) return null
  if (CONFLICT_FIELD_TO_CRITICAL[field]) return CONFLICT_FIELD_TO_CRITICAL[field]!
  const camel = field.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  if (CONFLICT_FIELD_TO_CRITICAL[camel]) return CONFLICT_FIELD_TO_CRITICAL[camel]!
  const mapped = mapCriticFieldToColumn(field)
  return mapped && isCriticalColumn(mapped) ? (mapped as CriticalColumn) : null
}

function isSystemSource(source: string): boolean {
  return source.trim().toLowerCase() === 'system'
}

/** Coerce a raw shipment property to a trimmed display string (dates → YYYY-MM-DD). */
function coerceLive(raw: unknown, type: 'text' | 'number' | 'date' | undefined): string {
  if (raw == null) return ''
  if (type === 'date') {
    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) return ''
      return raw.toISOString().slice(0, 10)
    }
    const s = String(raw).trim()
    if (!s) return ''
    // Already date-only or ISO — keep YYYY-MM-DD prefix when parseable
    const d = new Date(s)
    if (!Number.isNaN(d.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return s
  }
  return String(raw).trim()
}

function liveCritical(shipment: object, column: CriticalColumn): string {
  const meta = EDITABLE_FIELDS.find((f) => f.column === column)
  const bag = shipment as Record<string, unknown>
  for (const key of LIVE_KEYS[column]) {
    if (key in bag) return coerceLive(bag[key], meta?.type)
  }
  // Fallback: column name itself (detail/correct-shaped bags)
  if (column in bag) return coerceLive(bag[column], meta?.type)
  return ''
}

/** Live blank for critical columns (uses shipment detail / queue-shaped objects). */
export function criticalMissing(shipment: object | null | undefined): CriticalItem[] {
  if (shipment == null) {
    return CRITICAL_COLUMNS.map((column) => ({
      kind: 'missing' as const,
      column,
      label: fieldLabel(column),
    }))
  }
  const out: CriticalItem[] = []
  for (const column of CRITICAL_COLUMNS) {
    if (liveCritical(shipment, column) === '') {
      out.push({ kind: 'missing', column, label: fieldLabel(column) })
    }
  }
  return out
}

/** Conflicts whose mapped column is critical. */
export function criticalConflicts(
  conflicts: Array<{
    field: string
    label?: string
    candidates?: Array<{ value: string; source: string }>
  }>,
): CriticalItem[] {
  const out: CriticalItem[] = []
  for (const c of conflicts ?? []) {
    const column = resolveCriticalColumn(c.field)
    if (!column) continue
    const candidates = c.candidates ?? []
    const system = candidates.find((x) => isSystemSource(x.source))
    const nonSystem = candidates.find((x) => !isSystemSource(x.source))
    const existing = system?.value ?? candidates[0]?.value ?? ''
    const proposed =
      nonSystem?.value ??
      (system ? candidates.find((x) => x !== system)?.value : candidates[1]?.value) ??
      ''
    const summary = `${existing || '—'} vs ${proposed || '—'}`
    out.push({
      kind: 'conflict',
      column,
      label: fieldLabel(column),
      field: c.field,
      summary,
    })
  }
  return out
}

export function isCriticalColumn(column: string | null | undefined): boolean {
  return !!column && CRITICAL_SET.has(column)
}
