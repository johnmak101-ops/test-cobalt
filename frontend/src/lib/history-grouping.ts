/**
 * Group a shipment's Change History into the four Order Details field sections plus a
 * `Status & Lifecycle` catch-all, and match a single read-view field to its history entries.
 *
 * Section membership reuses the one field vocabulary (EDITABLE_FIELDS) so the History tab, the
 * Order Details hover, and the Review conflict table can never name a field's home differently.
 * A history entry's `field` is the LEG COLUMN vocabulary the backend emits — but with drift
 * (legacy snake_case audit rows, the committer's resolved/raw/id columns, email-replay tokens), so
 * we fold every variant to ONE canonical leg column before deciding its category or matching a row.
 */
import { EDITABLE_FIELDS, type EditableField } from './review-fields'
import type { HistoryEntry } from '../hooks/use-shipment-history'

export type HistoryCategory =
  | 'Order Info'
  | 'Cargo & Logistics'
  | 'Shipping'
  | 'Key Dates'
  | 'Status & Lifecycle'

/** Display order: the four field sections first, the lifecycle catch-all last. */
export const HISTORY_CATEGORY_ORDER: HistoryCategory[] = [
  'Order Info',
  'Cargo & Logistics',
  'Shipping',
  'Key Dates',
  'Status & Lifecycle',
]

const snakeToCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

const COLUMN_TO_SECTION: Record<string, EditableField['section']> = Object.fromEntries(
  EDITABLE_FIELDS.map((f) => [f.column, f.section]),
)

/**
 * Non-obvious field-key → canonical leg column. Only entries where the plain snake→camel of the key
 * is NOT already the leg column (e.g. `quantity_shipped`→`qty`, `pol`/`polId`→`polRaw`,
 * `voyage_number`→`voyageNo`). Straight snake_case (`gross_weight`, `cfs_cutoff`, `vessel_name`)
 * needs no entry — snakeToCamel lands on the column on its own.
 */
const ALIAS_TO_COLUMN: Record<string, string> = {
  quantity_shipped: 'qty',
  quantityShipped: 'qty',
  hbl_number: 'hblAwbFcrNo',
  hblNumber: 'hblAwbFcrNo',
  pol: 'polRaw',
  polId: 'polRaw',
  pod: 'podRaw',
  podId: 'podRaw',
  forwarder: 'forwarderRaw',
  forwarderId: 'forwarderRaw',
  forwarder_name: 'forwarderRaw',
  voyage_number: 'voyageNo',
  voyageNumber: 'voyageNo',
  crd: 'cargoReadyDate',
  actualDeparture: 'atd',
  actualArrival: 'ata',
  soNumber: 'soNo',
}

/** Leg fields that name a Shipping value but are read-only (not in EDITABLE_FIELDS). */
const SHIPPING_EXTRA = new Set(['route', 'originCountry'])

/**
 * Any history/leg field-key → its canonical leg column. Best effort: known aliases first, then the
 * leg column itself, then a snake→camel retry; unknown keys pass through camelised (visible, never
 * thrown) so a new backend key lands in Status & Lifecycle rather than vanishing.
 */
export function canonicalFieldKey(field: string): string {
  if (!field) return field
  if (ALIAS_TO_COLUMN[field]) return ALIAS_TO_COLUMN[field]!
  if (COLUMN_TO_SECTION[field]) return field
  const camel = snakeToCamel(field)
  if (ALIAS_TO_COLUMN[camel]) return ALIAS_TO_COLUMN[camel]!
  return camel
}

/** A history entry's `field` → the category it belongs under. Non-field / lifecycle keys → Status & Lifecycle. */
export function historyCategoryOf(field: string): HistoryCategory {
  const column = canonicalFieldKey(field)
  const section = COLUMN_TO_SECTION[column]
  if (section) return section
  if (SHIPPING_EXTRA.has(column)) return 'Shipping'
  return 'Status & Lifecycle'
}

export interface HistoryCategoryGroup {
  category: HistoryCategory
  entries: HistoryEntry[]
}

/**
 * Group history into the five categories in fixed order. Empty categories are omitted (an empty
 * header is noise) and entry order within a category is preserved (the backend sends newest-first).
 */
export function groupHistoryByCategory(history: HistoryEntry[]): HistoryCategoryGroup[] {
  const byCategory = new Map<HistoryCategory, HistoryEntry[]>()
  for (const entry of history) {
    const category = historyCategoryOf(entry.field)
    const bucket = byCategory.get(category)
    if (bucket) bucket.push(entry)
    else byCategory.set(category, [entry])
  }
  return HISTORY_CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    entries: byCategory.get(category)!,
  }))
}

/** Index history by canonical leg column → its entries, for O(1) per-field hover lookup. */
export function indexHistoryByField(history: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const index = new Map<string, HistoryEntry[]>()
  for (const entry of history) {
    const key = canonicalFieldKey(entry.field)
    const bucket = index.get(key)
    if (bucket) bucket.push(entry)
    else index.set(key, [entry])
  }
  return index
}

/** The history entries for a read-view field, addressed by its leg column (e.g. `qty`, `polRaw`). */
export function historyForField(column: string, index: Map<string, HistoryEntry[]>): HistoryEntry[] {
  return index.get(canonicalFieldKey(column)) ?? []
}
