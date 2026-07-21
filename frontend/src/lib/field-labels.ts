/**
 * Human-readable labels for shipment field keys as they appear in the Change History timeline.
 *
 * The `field` value on a history entry is the LEG COLUMN vocabulary the backend emits (see
 * backend email-timeline TRACKED + committer/review audit rows) — e.g. `bookingNo`, `cargoReadyDate`,
 * `pol`, `state` — NOT the display DTO. This renders those keys as proper labels instead of leaking
 * code casing. The editable fields reuse the Review page's single source of truth (EDITABLE_FIELDS);
 * EXTRA_LABELS covers the agent/committer- and email-replay-only keys that never appear there; any
 * unmapped key falls back to an acronym-aware humanizer so nothing ever renders as raw code.
 */
import { EDITABLE_FIELDS } from './review-fields'

/** column → label from the Review page (Booking No., HBL / AWB / FCR No., SCAC Code, …). */
const EDITABLE_LABELS: Record<string, string> = Object.fromEntries(
  EDITABLE_FIELDS.map((f) => [f.column, f.label]),
)

/** Keys the Review page doesn't list: email-replay tokens, master-resolution columns, lifecycle/audit. */
const EXTRA_LABELS: Record<string, string> = {
  // the value carries the unit ("214.238"), so the label omits (KGS)/(CBM)
  grossWeight: 'Gross Weight',
  measurement: 'Measurement',
  // 入仓/订仓 SO — distinct from soNo (SO#); never dual-written into so_no / booking_no
  warehouseSo: 'Warehouse SO',
  warehouse_so: 'Warehouse SO',
  // Bag item/style removed from Order Details form — styles live per-PO on the PO card
  itemStyleNo: 'Item / Style No.',
  item_style_no: 'Item / Style No.',
  // routing / parties — email-replay tokens + the committer's resolved/raw columns
  forwarder: 'Forwarder',
  forwarderId: 'Forwarder',
  forwarderRaw: 'Forwarder',
  pol: 'POL',
  polId: 'POL',
  polRaw: 'POL',
  pod: 'POD',
  podId: 'POD',
  podRaw: 'POD',
  originCountry: 'Origin Country',
  route: 'Route',
  mode: 'Mode',
  // air
  flightNo: 'Flight No.',
  mawb: 'MAWB',
  // lifecycle / audit-only
  state: 'Status',
  status: 'Status',
  reviewStatus: 'Review Status',
  kind: 'Record Type',
  poQtyConflict: 'PO Qty Conflict',
  po_qty_conflict: 'PO Qty Conflict',
  poEnrichmentFlag: 'PO Enrichment Flag',
  po_enrichment_flag: 'PO Enrichment Flag',
  // legacy snake_case keys from older audit rows
  vessel_name: 'Vessel',
  cfs_cutoff: 'CFS Cut-off',
  hbl_number: 'HBL / AWB / FCR No.',
  voyage_number: 'Voyage',
  quantity_shipped: 'Qty',
  risk_level: 'Risk Level',
}

const FIELD_LABELS: Record<string, string> = { ...EDITABLE_LABELS, ...EXTRA_LABELS }

/** Tokens that must stay all-caps when the humanizer falls back on an unmapped key. */
const ACRONYMS = new Set([
  'POL', 'POD', 'HBL', 'AWB', 'FCR', 'MBL', 'MAWB', 'ETD', 'ETA', 'ATD', 'ATA',
  'CFS', 'SO', 'HTS', 'SCAC', 'WH', 'DC', 'CBM', 'KG', 'KGS', 'UOM', 'PO', 'ID', 'FCL', 'LCL',
])

/** Split camelCase/snake_case/kebab, Title-Case each word, keep known acronyms upper-cased. */
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  if (!words.length) return key
  return words
    .map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

/** A history-entry field key → its display label. Never returns raw code casing. */
export function fieldLabel(key: string | null | undefined): string {
  if (!key) return ''
  return FIELD_LABELS[key] ?? humanize(key)
}
