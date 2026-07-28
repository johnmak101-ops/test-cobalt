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
   * 'customer' | 'vendor' | 'forwarder' → the Mesh party mirror, same free-text fallback (the mirror
   * lags the ERP by ~2 months). Customer/Vendor picks write the master CODE — the tier exactPartyId
   * resolves first, and what the read view shows as "Customer Code" / "Vendor Code". Forwarder picks
   * write the NAME instead: its read row renders the master name and its codes are numeric ERP ids.
   */
  picker?: 'port' | 'customer' | 'vendor' | 'forwarder'
  /**
   * A date column that genuinely carries a clock time, so its editor shows a time box beside the
   * calendar. Only the warehouse/CFS cut-off family does: 截仓/入仓 windows are stated to the hour
   * (4 of 5 stored warehouse_end_date values carry one), while ETD/ATD/ETA/ATA/CRD/In-DC are
   * day-level and had zero. A time box on a day-level field is noise, and it invites a spurious
   * 08:00 to be read as meaningful.
   */
  withTime?: true
  /**
   * The POST /shipments key for this field, when it differs from the leg column.
   *
   * The create endpoint speaks the committer's vocabulary (`customer_code` → `customerCode`), the
   * edit endpoint speaks leg columns (`customerRaw`) — the same value, two names, because one goes
   * through master resolution and the other writes the raw twin directly. Only the five
   * master-resolved fields differ; everything else uses its column name, which is why this is an
   * exception list and not a second table.
   */
  createKey?: string
}

/** POST /shipments key for an editable field — its column unless the create DTO renames it. */
export function createFieldKey(f: EditableField): string {
  return f.createKey ?? f.column
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
  // "…Code", not bare "Customer"/"Vendor": a pick now stores the master CODE, and the read view rows
  // are already labelled this way, so all three surfaces (read, edit, review conflict row) agree on
  // both the name and the thing named. Forwarder keeps the bare label — it stores a NAME.
  { section: 'Shipping', label: 'Customer Code', uiKey: 'customerRaw', column: 'customerRaw', type: 'text', picker: 'customer', createKey: 'customerCode' },
  { section: 'Shipping', label: 'Vendor Code', uiKey: 'vendorRaw', column: 'vendorRaw', type: 'text', picker: 'vendor', createKey: 'vendorCode' },
  { section: 'Shipping', label: 'Forwarder', uiKey: 'forwarderRaw', column: 'forwarderRaw', type: 'text', picker: 'forwarder', createKey: 'forwarderName' },
  { section: 'Shipping', label: 'Consignee Name', uiKey: 'consigneeName', column: 'consigneeName', type: 'text' },
  { section: 'Shipping', label: 'Consignee Address', uiKey: 'consigneeAddress', column: 'consigneeAddress', type: 'text' },
  { section: 'Shipping', label: 'Vessel', uiKey: 'vesselName', column: 'vesselName', type: 'text' },
  { section: 'Shipping', label: 'Voyage', uiKey: 'voyageNumber', column: 'voyageNo', type: 'text' },
  { section: 'Shipping', label: 'Flight No.', uiKey: 'flightNo', column: 'flightNo', type: 'text' },
  { section: 'Shipping', label: 'POL', uiKey: 'polRaw', column: 'polRaw', type: 'text', picker: 'port', createKey: 'pol' },
  { section: 'Shipping', label: 'POD', uiKey: 'podRaw', column: 'podRaw', type: 'text', picker: 'port', createKey: 'pod' },
  { section: 'Key Dates', label: 'Cargo Ready Date', uiKey: 'crd', column: 'cargoReadyDate', type: 'date' },
  { section: 'Key Dates', label: 'WH Start Date', uiKey: 'warehouseStartDate', column: 'warehouseStartDate', type: 'date', withTime: true },
  { section: 'Key Dates', label: 'WH End Date', uiKey: 'warehouseEndDate', column: 'warehouseEndDate', type: 'date', withTime: true },
  { section: 'Key Dates', label: 'CFS Cut-off', uiKey: 'cfsCutoff', column: 'cfsCutoff', type: 'date', withTime: true },
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
 * Columns whose value has a well-defined SHAPE, and the message when it does not have it.
 *
 * 🔴 These mirror `backend/src/shipments/coerce-field.ts` — same patterns, same wording, because the
 * backend throws a 400 on a mismatch and two different phrasings of one rule is how an operator ends
 * up distrusting both. `review-fields.format-gate.test.ts` reads that file and fails if either side
 * moves.
 *
 * Without a mirror the rule still HELD — it just arrived from the server, after a round trip, as one
 * line at the foot of a 31-field scrolling form ("Failed to create — Container No. must be 4 letters
 * + 7 digits"), with the offending field somewhere off screen. The rule was never the problem; being
 * told about it three hundred pixels away from the box that was wrong was.
 *
 * HTS is deliberately absent, on both sides: its forms vary (6/8/10-digit, dotted like 6110.20.2020),
 * so there is no shape to gate.
 */
const FORMAT_GATES: Record<string, { re: RegExp; message: string }> = {
  // SCAC = Standard Carrier Alpha Code: 2-4 letters.
  scacCode: { re: /^[A-Za-z]{2,4}$/, message: 'SCAC Code must be 2–4 letters (e.g. MAEU)' },
  // ISO 6346: 4 letters (owner + U/J/Z category) + 7 digits (6 serial + 1 check).
  containerNo: { re: /^[A-Za-z]{4}\d{7}$/, message: 'Container No. must be 4 letters + 7 digits, e.g. MSBU7281200' },
}

/** Inline hard error for a leg column's FORMAT. Empty is always fine — it clears the field. */
export function formatFieldWarn(column: string, value: string | undefined): string | null {
  const gate = FORMAT_GATES[column]
  if (!gate) return null
  const v = (value ?? '').trim()
  if (v === '') return null
  return gate.re.test(v) ? null : gate.message
}

/**
 * EVERY inline hard error for one field — numeric range or format.
 *
 * Callers use this rather than the two halves, so a gate added to either kind reaches every form
 * without each one remembering to ask twice. That is exactly how the format gates were missed: both
 * forms asked `numericFieldWarn` and only for `type === 'number'`, so a text column with a shape had
 * no way to be checked at all.
 */
export function fieldWarn(column: string, value: string | undefined): string | null {
  return numericFieldWarn(column, value) ?? formatFieldWarn(column, value)
}

/**
 * Cross-field date sanity for the human edit form: every departure (ETD/ATD) must be before every
 * arrival (ETA/ATA). Estimate and actual float freely — ETD↔ATD and ETA↔ATA are never compared (an
 * estimate may fall either side of the actual). Returns the first "arrival before departure"
 * violation, or null. Lives here (not backend `coerceLegField`) because it needs sibling fields.
 */
/**
 * One arrival that lands before a departure, and every departure it precedes.
 *
 * Per ARRIVAL rather than per pair: a leg can violate several at once — ETD 12/07, ATD 08/07,
 * ETA 07/07, ATA 29/12/2025 breaks four ways — and the old check `return`ed on the first match, so
 * the form reported "ETA is before ETD" and said nothing about an ATA a year in the past. The
 * operator fixed the one they were shown, saved, and met the next.
 */
export interface DateOrderIssue {
  /** Leg column of the arrival that is too early — where the message belongs. */
  arrival: 'eta' | 'ata'
  /** Every departure it precedes; any of them could be the wrong value, so all are named. */
  departures: ('etd' | 'atd')[]
  message: string
}

const DATE_LABEL: Record<string, string> = { etd: 'ETD', atd: 'ATD', eta: 'ETA', ata: 'ATA' }

/** Every violation on the leg, one entry per offending arrival. Empty when the dates are sane. */
export function dateOrderIssues(dates: {
  etd?: string
  atd?: string
  eta?: string
  ata?: string
}): DateOrderIssue[] {
  const ms = (v: string | undefined): number | null => {
    if (!v || v.trim() === '') return null
    const t = new Date(v).getTime()
    return Number.isNaN(t) ? null : t
  }
  const deps = [
    { col: 'etd' as const, t: ms(dates.etd) },
    { col: 'atd' as const, t: ms(dates.atd) },
  ].filter((d) => d.t != null)
  const arrs = [
    { col: 'eta' as const, t: ms(dates.eta) },
    { col: 'ata' as const, t: ms(dates.ata) },
  ].filter((a) => a.t != null)

  const out: DateOrderIssue[] = []
  for (const a of arrs) {
    const before = deps.filter((d) => a.t! < d.t!).map((d) => d.col)
    if (before.length === 0) continue
    const names = before.map((c) => DATE_LABEL[c]).join(' and ')
    out.push({
      arrival: a.col,
      departures: before,
      message: `${DATE_LABEL[a.col]} is before ${names} — arrival can't be before departure`,
    })
  }
  return out
}

/** The first violation, for callers that can show only one. */
export function dateOrderIssue(dates: {
  etd?: string
  atd?: string
  eta?: string
  ata?: string
}): DateOrderIssue | null {
  return dateOrderIssues(dates)[0] ?? null
}

/** Message-only form, for callers with nowhere to put a per-field marker (the review card's grid). */
export function dateOrderWarn(dates: {
  etd?: string
  atd?: string
  eta?: string
  ata?: string
}): string | null {
  return dateOrderIssue(dates)?.message ?? null
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

const NUMERIC_COLUMNS = new Set<string>()
for (const f of EDITABLE_FIELDS) {
  if (f.type === 'number') NUMERIC_COLUMNS.add(f.column)
}
// grossWeight / measurement are numeric leg columns that EDITABLE_FIELDS deliberately omits from the
// Order Details form, but a critic conflict can still carry them — they must not fall through to a
// free-text input, so the numeric set covers them too (mirrors backend NUMERIC_FIELDS).
for (const c of ['grossWeight', 'measurement']) NUMERIC_COLUMNS.add(c)

/** True when this leg column holds a number — the input must restrict, and the display may group. */
export function isNumericColumn(column: string | null | undefined): boolean {
  return !!column && NUMERIC_COLUMNS.has(column)
}

/**
 * Strip thousands separators so an agent value like "1,240" (a packing list writes them) seeds a
 * number input instead of rendering blank. Anything that is not a clean number after stripping is
 * returned untouched, so junk stays visible for the operator to see rather than silently vanishing.
 */
export function normalizeNumericInput(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const stripped = raw.replace(/,/g, '')
  return /^-?\d*\.?\d+$/.test(stripped) ? stripped : raw
}

/**
 * Group a numeric value for READ display ("1180" → "1,180"). Display only — never fed back into an
 * input, because the grouped form is exactly what Number() chokes on. Non-numeric input is passed
 * through unchanged so a bad value is shown as-is rather than mangled.
 */
export function formatNumericDisplay(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n)) return raw
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

const DATE_COLUMNS = new Set<string>()
for (const f of EDITABLE_FIELDS) {
  if (f.type === 'date') DATE_COLUMNS.add(f.column)
}

const DATE_TIME_COLUMNS = new Set<string>()
for (const f of EDITABLE_FIELDS) {
  if (f.type === 'date' && f.withTime) DATE_TIME_COLUMNS.add(f.column)
}

/** True when a date column also carries a clock time (the cut-off family) — show the time box. */
export function dateColumnHasTime(column: string | null | undefined): boolean {
  return !!column && DATE_TIME_COLUMNS.has(column)
}

/** True when this leg column holds a date — edit it with DateTimeField, never a bare text box. */
export function isDateColumn(column: string | null | undefined): boolean {
  return !!column && DATE_COLUMNS.has(column)
}

const PARTY_PICKER_COLUMNS = new Map<string, 'customer' | 'vendor' | 'forwarder'>()
for (const f of EDITABLE_FIELDS) {
  if (f.picker === 'customer' || f.picker === 'vendor' || f.picker === 'forwarder') {
    PARTY_PICKER_COLUMNS.set(f.column, f.picker)
  }
}

/**
 * Which party master backs this leg column, or null when it is plain free text. Derived from
 * EDITABLE_FIELDS so the shipment edit form and the review conflict row cannot drift — the two
 * surfaces disagreeing about how a field is edited is exactly the bug this centralises away.
 */
export function partyPickerKind(
  column: string | null | undefined,
): 'customer' | 'vendor' | 'forwarder' | null {
  return (column && PARTY_PICKER_COLUMNS.get(column)) || null
}

/**
 * The legal values for an enum-constrained column (UOM, Mode), or null when the column is free text.
 *
 * The review conflict row had every OTHER edit affordance derived from EDITABLE_FIELDS — port
 * picker, party picker, date field, numeric field — and no enum branch, so UOM and Mode fell through
 * to a bare text input while the Order Details form rendered a `<select>` for exactly those two. An
 * operator could type `cartonssdfsdf` into UOM from the review desk and nowhere else.
 *
 * `current` is folded in when it is not already offered. `allValues` exists because Mode's offer
 * list is deliberately shorter than its legal set (SEA/AIR offered, more stored), and a leg holding
 * one of the unoffered values must stay selectable rather than being silently rewritten by the act
 * of opening the dropdown.
 */
export function fieldOptions(
  column: string | null | undefined,
  current?: string | null,
): string[] | null {
  const meta = column ? EDITABLE_FIELDS.find((f) => f.column === column) : null
  if (!meta?.options) return null
  const legal = new Set<string>([...(meta.allValues ?? meta.options)])
  const out = [...meta.options]
  const c = (current ?? '').trim()
  if (c !== '' && !out.some((o) => o.toUpperCase() === c.toUpperCase())) {
    // A stored value outside the offer list is still valid (see allValues) — and even one that is
    // NOT legal has to be offered, or the dropdown cannot represent what the leg actually holds.
    out.push(c)
    if (!legal.has(c)) out.sort()
  }
  return out
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
