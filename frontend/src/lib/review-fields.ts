/**
 * Editable-field metadata for the Review Shipment page.
 * uiKey = the field name on the UiShipment payload (GET /api/shipments/:id);
 * column = the leg column name POST /api/review/:id/correct expects (it updates the row and
 * field-locks by column). The backend coerces values (dates → Date, numerics → number).
 */
import { MODE_OPTIONS, MODE_EDIT_OPTIONS, UOM_OPTIONS } from './enums'

export type FieldType = 'text' | 'number' | 'date'

/**
 * THE shipment field vocabulary — labels and section placement for every editable leg column.
 *
 * Single source on purpose: the Order Details page, its edit modal, and the review-queue conflict
 * table all render the same fields, and when each kept its own copy they drifted (one said
 * "Gross Weight (KGS)", another "Gross Weight", a third "Gross weight" from the queue's payload).
 *
 * Two conventions, both taken from the Order Details page because that is what users read most:
 *   - Sections are `Order Info | Cargo & Logistics | Shipping | Key Dates` — the strong identifiers
 *     (HBL/MBL/container/SCAC) belong to Cargo & Logistics; Shipping is the parties and the means.
 *   - A label NEVER carries its unit: the VALUE does ("1046.64 KGS"). So `Gross Weight`, not
 *     `Gross Weight (KGS)`.
 */
export interface EditableField {
  section: 'Order Info' | 'Cargo & Logistics' | 'Shipping' | 'Key Dates'
  label: string
  uiKey: string
  column: string
  type: FieldType
  /**
   * Fixed unit rendered beside the VALUE. Only for quantities whose unit is invariant — weight is
   * always KGS, volume always CBM. `qty` deliberately has NONE: its unit is the leg's own UOM
   * (cartons vs pieces), so a constant here would state something untrue.
   */
  unit?: string
  /**
   * When set, the edit form renders a `<select>` instead of a free-text input (enum-constrained
   * columns: UOM, Mode). Values mirror `backend/src/db/enums.ts`.
   */
  options?: readonly string[]
  /**
   * Full legal enum when `options` is a deliberately SHORTER offer list (Mode shows SEA/AIR only).
   * A current value in here but not in `options` is still valid — rendered selectable, never
   * suffixed "(unrecognized)". Defaults to `options`.
   */
  allValues?: readonly string[]
  /**
   * When set, the edit form and the review conflict row render a master picker instead of free text.
   * 'port' → a searchable UN/LOCODE dropdown (ports are a seeded, complete master), with a free-text
   * fallback for a port not yet in the catalog. The chosen value is written to the raw column.
   */
  picker?: 'port'
}

export const EDITABLE_FIELDS: EditableField[] = [
  { section: 'Order Info', label: 'Booking No.', uiKey: 'bookingNo', column: 'bookingNo', type: 'text' },
  // Read view combines the two SOs into one row ("A · B", see displaySoNumber); the EDIT form keeps
  // them apart — one input per column, so the warehouse (入仓) SO is editable on its own (2026-07-24).
  { section: 'Order Info', label: 'SO#', uiKey: 'soNumber', column: 'soNo', type: 'text' },
  { section: 'Order Info', label: 'Warehouse SO', uiKey: 'warehouseSo', column: 'warehouseSo', type: 'text' },
  // Item / Style No. lives on Customer Purchase Orders (per-PO), not Order Details — see HIDDEN_FIELD_LABELS.
  { section: 'Cargo & Logistics', label: 'Total Quantity', uiKey: 'quantityShipped', column: 'qty', type: 'number' },
  { section: 'Cargo & Logistics', label: 'UOM', uiKey: 'quantityUnit', column: 'qtyUnit', type: 'text', options: UOM_OPTIONS },
  // Measurement (CBM) removed from Order Details + review conflict table — same as gross weight / HTS.
  { section: 'Cargo & Logistics', label: 'Container No.', uiKey: 'containerNo', column: 'containerNo', type: 'text' },
  { section: 'Cargo & Logistics', label: 'HBL / HAWB / FCR No.', uiKey: 'hblNumber', column: 'hblAwbFcrNo', type: 'text' },
  { section: 'Cargo & Logistics', label: 'MBL', uiKey: 'mblNumber', column: 'mbl', type: 'text' },
  { section: 'Cargo & Logistics', label: 'MAWB', uiKey: 'mawb', column: 'mawb', type: 'text' },
  { section: 'Cargo & Logistics', label: 'SCAC Code', uiKey: 'scacCode', column: 'scacCode', type: 'text' },
  // Mode + party/port *raw* free text — also on PATCH detail edit / review correct. #183: operators
  // could see Route/Forwarder read-only but not fix them after bad extraction. Mode is enum-gated.
  // POL/POD pick from the seeded ports master (picker:'port'); Customer/Vendor/Forwarder are free text
  // because their masters are the Mesh ERP mirror (synced ~every 2 months) — the raw column is the only
  // place to record the correct party until the master arrives, at which point the master wins display.
  //
  // Intra-section ORDER is the read view's order too (parties → consignee → vessel → ports; dates in
  // shipment chronology). The edit form is generated from this array, so a different order here makes
  // the two modes of one card reshuffle under the user's cursor — the drift the derivation exists to
  // prevent. Customer/Vendor have no raw row on the read view (codes live under Order Info); they sit
  // with the other parties, between Mode and Forwarder.
  { section: 'Shipping', label: 'Mode', uiKey: 'mode', column: 'mode', type: 'text', options: MODE_EDIT_OPTIONS, allValues: MODE_OPTIONS },
  { section: 'Shipping', label: 'Customer', uiKey: 'customerRaw', column: 'customerRaw', type: 'text' },
  { section: 'Shipping', label: 'Vendor', uiKey: 'vendorRaw', column: 'vendorRaw', type: 'text' },
  { section: 'Shipping', label: 'Forwarder', uiKey: 'forwarderRaw', column: 'forwarderRaw', type: 'text' },
  { section: 'Shipping', label: 'Consignee Name', uiKey: 'consigneeName', column: 'consigneeName', type: 'text' },
  { section: 'Shipping', label: 'Consignee Address', uiKey: 'consigneeAddress', column: 'consigneeAddress', type: 'text' },
  { section: 'Shipping', label: 'Vessel', uiKey: 'vesselName', column: 'vesselName', type: 'text' },
  { section: 'Shipping', label: 'Voyage', uiKey: 'voyageNumber', column: 'voyageNo', type: 'text' },
  { section: 'Shipping', label: 'Flight No.', uiKey: 'flightNo', column: 'flightNo', type: 'text' },
  { section: 'Shipping', label: 'POL', uiKey: 'polRaw', column: 'polRaw', type: 'text', picker: 'port' },
  { section: 'Shipping', label: 'POD', uiKey: 'podRaw', column: 'podRaw', type: 'text', picker: 'port' },
  { section: 'Key Dates', label: 'Cargo Ready Date', uiKey: 'crd', column: 'cargoReadyDate', type: 'date' },
  { section: 'Key Dates', label: 'WH Start Date', uiKey: 'warehouseStartDate', column: 'warehouseStartDate', type: 'date' },
  { section: 'Key Dates', label: 'WH End Date', uiKey: 'warehouseEndDate', column: 'warehouseEndDate', type: 'date' },
  { section: 'Key Dates', label: 'CFS Cut-off', uiKey: 'cfsCutoff', column: 'cfsCutoff', type: 'date' },
  { section: 'Key Dates', label: 'ETD', uiKey: 'etd', column: 'etd', type: 'date' },
  { section: 'Key Dates', label: 'ATD', uiKey: 'actualDeparture', column: 'atd', type: 'date' },
  { section: 'Key Dates', label: 'ETA', uiKey: 'eta', column: 'eta', type: 'date' },
  { section: 'Key Dates', label: 'ATA', uiKey: 'actualArrival', column: 'ata', type: 'date' },
  { section: 'Key Dates', label: 'In DC Date', uiKey: 'inDcDate', column: 'inDcDate', type: 'date' },
]

/**
 * Inline hard error for numeric leg columns on the human edit form. Mirrors backend
 * `coerceLegField` numeric rules so Save can be disabled before a 400.
 * Empty / non-numeric → null (no warning; backend clears or ignores junk).
 */
export function numericFieldWarn(column: string, value: string | undefined): string | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const labels: Record<string, string> = {
    qty: 'Total Quantity',
    grossWeight: 'Gross Weight',
    measurement: 'Measurement',
  }
  const label = labels[column]
  if (!label) return null
  if (n < 0) return `${label} cannot be negative`
  if (column === 'qty' && (n === 0 || !Number.isInteger(n))) {
    return `${label} must be a whole number greater than 0`
  }
  return null
}

/**
 * Cross-field date sanity for the human edit form: every departure (ETD/ATD) must be before every
 * arrival (ETA/ATA). Estimate and actual float freely — ETD↔ATD and ETA↔ATA are never compared (an
 * estimate may fall either side of the actual). Returns the first "arrival before departure"
 * violation, or null. Lives here (not backend `coerceLegField`) because it needs sibling fields.
 */
export function dateOrderWarn(dates: {
  etd?: string
  atd?: string
  eta?: string
  ata?: string
}): string | null {
  const ms = (v: string | undefined): number | null => {
    if (!v || v.trim() === '') return null
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? null : t
  }
  const deps = [
    { k: 'ETD', t: ms(dates.etd) },
    { k: 'ATD', t: ms(dates.atd) },
  ]
  const arrs = [
    { k: 'ETA', t: ms(dates.eta) },
    { k: 'ATA', t: ms(dates.ata) },
  ]
  for (const d of deps) {
    if (d.t == null) continue
    for (const a of arrs) {
      if (a.t != null && a.t < d.t) return `${a.k} is before ${d.k} — arrival can't be before departure`
    }
  }
  return null
}

/** Shipment value → what the <input> shows. Dates render as LOCAL datetime-local ("2026-06-29T15:00")
 *  so editing a timed cut-off (截仓时间 15:00) never silently drops the time; null renders ''. */
export function toInputValue(value: unknown, type: FieldType): string {
  if (value == null) return ''
  if (type === 'date') {
    const d = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 16)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  return String(value)
}

/**
 * Dirty-diff of the edit form against the fetched shipment, keyed by LEG COLUMN for the
 * correct endpoint. Values stay strings — the backend coerces ('' → null clears the field).
 */
export function buildCorrections(
  original: Record<string, unknown>,
  edited: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of EDITABLE_FIELDS) {
    if (!(f.uiKey in edited)) continue
    const before = toInputValue(original[f.uiKey], f.type)
    const after = edited[f.uiKey] ?? ''
    if (after !== before) out[f.column] = after
  }
  return out
}

/** One row of the Items/Styles table editor. Entries are 'PO/STYLE' pairs or bare style codes. */
export interface StyleEntry {
  po: string
  style: string
}

/**
 * Parse a styles list from storage or clipboard.
 * Accepts commas / semicolons, Excel rows (newlines), Excel columns (tabs), and CJK commas.
 * '4483262/LKN18360L15, LKN1794' → [{po:'4483262', style:'LKN18360L15'}, {po:'', style:'LKN1794'}]
 */
export function parseStyleEntries(value: string | null | undefined): StyleEntry[] {
  if (!value) return []
  // Excel paste: cells are tab-separated, rows newline-separated → treat both as separators.
  const normalized = String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t\n]+/g, ',')
  return normalized
    .split(/[,;，]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const slash = entry.indexOf('/')
      if (slash > 0 && slash < entry.length - 1) {
        return { po: entry.slice(0, slash).trim(), style: entry.slice(slash + 1).trim() }
      }
      return { po: '', style: entry }
    })
}

/** True when clipboard text looks like a multi-style paste (Excel / comma list), not one token. */
export function isMultiStylePaste(text: string): boolean {
  return /[,\n\r\t;，]/.test(text)
}

/**
 * Per-PO style lists: split ONLY on list separators — a slash belongs to the style itself
 * ("C193/FERN JUMPER" is one token). PO/STYLE pair semantics (parseStyleEntries) apply only to
 * bag-level lists that span POs, where the prefix genuinely names a PO (2026-07-24).
 */
export function parseStyleTokens(value: string | null | undefined): string[] {
  if (!value) return []
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\t\n]+/g, ',')
    .split(/[,;，]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Inverse of parseStyleTokens — blank tokens dropped, comma-joined. */
export function serializeStyleTokens(tokens: string[]): string {
  return tokens
    .flatMap((t) => {
      const s = t.trim()
      return s ? [s] : []
    })
    .join(', ')
}

/** Inverse of parseStyleEntries — empty rows dropped, 'po/style' or bare style, comma-joined. */
export function serializeStyleEntries(rows: StyleEntry[]): string {
  return rows
    .flatMap((r) => {
      const po = r.po.trim()
      const style = r.style.trim()
      if (!po && !style) return []
      return [po ? `${po}/${style || ''}`.replace(/\/$/, '') : style]
    })
    .join(', ')
}

const COLUMN_SET = new Set(EDITABLE_FIELDS.map((f) => f.column))
const snakeToCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/**
 * Critic-only field names that map to leg columns outside the Order Details form vocabulary.
 * Without these, Review Queue shows pol/forwarder conflicts under "Other" but Save silently drops them (#181).
 */
const CRITIC_EXTRA_COLUMNS: Record<string, string> = {
  pol: 'polRaw',
  pod: 'podRaw',
  forwarder_name: 'forwarderRaw',
  // Customer / vendor conflicts → the free-text raw column (no Mesh write; master wins once it resolves).
  // The critic may name the party a few ways — code, name, or bare — so accept all of them.
  customer: 'customerRaw',
  customer_code: 'customerRaw',
  customer_name: 'customerRaw',
  vendor: 'vendorRaw',
  vendor_code: 'vendorRaw',
  vendor_name: 'vendorRaw',
  mode: 'mode',
  flight_no: 'flightNo',
  mawb: 'mawb',
  // Still map for critic/history labels; not on Order Details form (HIDDEN_FIELD_LABELS)
  gross_weight: 'grossWeight',
  grossWeight: 'grossWeight',
  measurement: 'measurement',
  hts_code: 'htsCode',
  htsCode: 'htsCode',
  warehouse_so: 'warehouseSo',
  warehouseSo: 'warehouseSo',
  item_style_no: 'itemStyleNo',
  itemStyleNo: 'itemStyleNo',
  // Voyage aliases (history + some critic payloads use voyage_number / voyageNumber)
  voyage_number: 'voyageNo',
  voyageNumber: 'voyageNo',
  // already camel
  polRaw: 'polRaw',
  podRaw: 'podRaw',
  forwarderRaw: 'forwarderRaw',
  customerRaw: 'customerRaw',
  vendorRaw: 'vendorRaw',
  flightNo: 'flightNo',
}

const WRITABLE_COLUMN_SET = new Set([...COLUMN_SET, ...Object.values(CRITIC_EXTRA_COLUMNS)])

/**
 * Critic `conflict.field` (parser snake_case e.g. `hbl_awb_fcr_no`, or already-camel leg column)
 * → POST /api/review/:id/correct leg column. Unknown keys → null (do not invent columns).
 */
export function mapCriticFieldToColumn(field: string): string | null {
  if (!field) return null
  if (CRITIC_EXTRA_COLUMNS[field]) return CRITIC_EXTRA_COLUMNS[field]!
  if (WRITABLE_COLUMN_SET.has(field)) return field
  const camel = snakeToCamel(field)
  if (CRITIC_EXTRA_COLUMNS[camel]) return CRITIC_EXTRA_COLUMNS[camel]!
  return WRITABLE_COLUMN_SET.has(camel) ? camel : null
}

/** True when /correct will accept this camelCase leg column (frontend + backend allowlists must match). */
export function isWritableLegColumn(column: string): boolean {
  return WRITABLE_COLUMN_SET.has(column)
}

const PORT_PICKER_COLUMNS = new Set<string>()
for (const f of EDITABLE_FIELDS) {
  if (f.picker === 'port') PORT_PICKER_COLUMNS.add(f.column)
}

/** True when this leg column (POL/POD) should be edited via the seeded ports-master picker, not free text. */
export function isPortColumn(column: string | null | undefined): boolean {
  return !!column && PORT_PICKER_COLUMNS.has(column)
}

/**
 * Map a ReviewCard / critic payload field bag to CorrectDto keys (camelCase leg columns).
 * Drops keys that do not map to an editable leg column so we never POST snake_case garbage.
 */
export function mapCriticFieldsToColumns(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields ?? {})) {
    const col = mapCriticFieldToColumn(k)
    if (col) out[col] = v
  }
  return out
}

/**
 * Group headers for the review card's conflict table: the EDITABLE_FIELDS sections, plus `Other` for
 * anything we cannot place. Deliberately NOT the demo's headers ("Shipping Parties", "Dates") — the
 * conflict table sits two clicks from Order Details, and two names for one section is the drift.
 */
export type ReviewGroup = EditableField['section'] | 'Other'

/** Render order of the group headers. `Other` is last — it is the catch-all, not a real section. */
export const REVIEW_GROUP_ORDER: ReviewGroup[] = [
  'Order Info',
  'Cargo & Logistics',
  'Shipping',
  'Key Dates',
  'Other',
]

/**
 * Critic `conflict.field` → the group header it renders under.
 *
 * NOT an allowlist: a field that maps to no editable leg column falls back to `Other` instead of
 * vanishing. `mapCriticFieldsToColumns` deliberately DROPS unknown keys (it feeds CorrectDto, which
 * must not invent columns) — but dropping a row here would make the conflict COUNT disagree with the
 * rows rendered beneath it, which is exactly the count-vs-rows class of bug. Visible-but-unplaced
 * beats silently-gone.
 */
export function reviewGroupOf(field: string): ReviewGroup {
  // Ports / mode / parties from critic → Shipping (not a lonely "Other" bin). NOTE: not `customer` —
  // that would swallow `customer_po` (a PO number, genuinely Other). `customer`/`customer_code` route
  // to Shipping via the customerRaw column mapping below; only the bare-PO field falls through to Other.
  if (/^(pol|pod|mode|forwarder|vendor)/i.test(field)) return 'Shipping'
  const column = mapCriticFieldToColumn(field)
  const meta = column ? EDITABLE_FIELDS.find((f) => f.column === column) : null
  return meta?.section ?? 'Other'
}

/**
 * Labels for columns we still humanize (history, critic conflict copy) but do **not** show on
 * Order Details read/edit — e.g. gross weight / HTS removed from the form per product.
 */
const HIDDEN_FIELD_LABELS: Record<string, string> = {
  grossWeight: 'Gross Weight',
  measurement: 'Measurement',
  htsCode: 'HTS Code',
  // Per-PO styles live on Purchase Orders card / ReviewPoStylesSection — not Order Details bag field
  itemStyleNo: 'Item / Style No.',
}

/**
 * Label for a leg COLUMN, from the one vocabulary. Every surface that names a field goes through
 * here (Order Details read view + its edit modal + the review conflict table) so a wording change
 * lands in one place instead of three.
 *
 * Falls back to the column name for an unknown key: visible and greppable, rather than a blank
 * label or a throw in production. The accompanying test pins the columns the read view renders, so
 * a rename fails there first.
 */
export function fieldLabel(column: string): string {
  return (
    EDITABLE_FIELDS.find((f) => f.column === column)?.label ??
    HIDDEN_FIELD_LABELS[column] ??
    column
  )
}

/** The fixed unit for a column, or null when it has none (see EditableField.unit). */
export function fieldUnit(column: string): string | null {
  return EDITABLE_FIELDS.find((f) => f.column === column)?.unit ?? null
}

/**
 * Display label for a contested field. OUR vocabulary (EDITABLE_FIELDS) wins over the label the
 * queue's critic shipped, so the two apps cannot drift apart in wording and the queue cannot change
 * ShipTrack's UI copy by editing a prompt. Falls back to the payload's label for fields we do not
 * own — a field with no local metadata is still worth showing under whatever name it arrived with.
 */
export function reviewFieldLabel(field: string, fallback: string): string {
  const column = mapCriticFieldToColumn(field)
  return column ? fieldLabel(column) : fallback
}

/**
 * Bucket contested fields into the demo's group headers, in REVIEW_GROUP_ORDER. Groups with no
 * conflicts are omitted (the card renders ONLY contested rows — an empty header is noise), and an
 * empty conflict set yields no groups at all so the caller can render its zero-conflict state.
 * Conflict order within a group is preserved.
 */
export function groupConflictFields<T extends { field: string }>(
  conflicts: T[],
): { group: ReviewGroup; conflicts: T[] }[] {
  const byGroup = new Map<ReviewGroup, T[]>()
  for (const c of conflicts) {
    const g = reviewGroupOf(c.field)
    const bucket = byGroup.get(g)
    if (bucket) bucket.push(c)
    else byGroup.set(g, [c])
  }
  return REVIEW_GROUP_ORDER.filter((g) => byGroup.has(g)).map((group) => ({
    group,
    conflicts: byGroup.get(group)!,
  }))
}

/**
 * Parse "why review?" reason strings (e.g. "backend conflict on qty, gross_weight, measurement")
 * into the leg columns they name, so the form can highlight the contested fields.
 */
export function conflictColumns(reasons: string[]): string[] {
  const found = new Set<string>()
  for (const reason of reasons) {
    for (const token of String(reason).toLowerCase().match(/[a-z][a-z0-9_]*/g) ?? []) {
      const col = snakeToCamel(token)
      if (COLUMN_SET.has(col)) found.add(col)
    }
  }
  return [...found]
}
