/**
 * Editable-field metadata for the Review Shipment page.
 * uiKey = the field name on the UiShipment payload (GET /api/shipments/:id);
 * column = the leg column name POST /api/review/:id/correct expects (it updates the row and
 * field-locks by column). The backend coerces values (dates → Date, numerics → number).
 */
export type FieldType = 'text' | 'number' | 'date'

export interface EditableField {
  section: 'Order Info' | 'Cargo' | 'Shipping IDs' | 'Key Dates'
  label: string
  uiKey: string
  column: string
  type: FieldType
}

export const EDITABLE_FIELDS: EditableField[] = [
  { section: 'Order Info', label: 'Booking No.', uiKey: 'bookingNo', column: 'bookingNo', type: 'text' },
  { section: 'Order Info', label: 'SO#', uiKey: 'soNumber', column: 'soNo', type: 'text' },
  { section: 'Order Info', label: 'Item / Style No.', uiKey: 'itemStyleNo', column: 'itemStyleNo', type: 'text' },
  { section: 'Cargo', label: 'Qty', uiKey: 'quantityShipped', column: 'qty', type: 'number' },
  { section: 'Cargo', label: 'UOM', uiKey: 'quantityUnit', column: 'qtyUnit', type: 'text' },
  { section: 'Cargo', label: 'Gross Weight (KGS)', uiKey: 'grossWeight', column: 'grossWeight', type: 'number' },
  { section: 'Cargo', label: 'Measurement (CBM)', uiKey: 'measurement', column: 'measurement', type: 'number' },
  { section: 'Cargo', label: 'HTS Code', uiKey: 'htsCode', column: 'htsCode', type: 'text' },
  { section: 'Shipping IDs', label: 'HBL / AWB / FCR No.', uiKey: 'hblNumber', column: 'hblAwbFcrNo', type: 'text' },
  { section: 'Shipping IDs', label: 'MBL', uiKey: 'mblNumber', column: 'mbl', type: 'text' },
  { section: 'Shipping IDs', label: 'Container No.', uiKey: 'containerNo', column: 'containerNo', type: 'text' },
  { section: 'Shipping IDs', label: 'SCAC Code', uiKey: 'scacCode', column: 'scacCode', type: 'text' },
  { section: 'Shipping IDs', label: 'Vessel', uiKey: 'vesselName', column: 'vesselName', type: 'text' },
  { section: 'Shipping IDs', label: 'Voyage', uiKey: 'voyageNumber', column: 'voyageNo', type: 'text' },
  { section: 'Shipping IDs', label: 'Consignee Name', uiKey: 'consigneeName', column: 'consigneeName', type: 'text' },
  { section: 'Shipping IDs', label: 'Consignee Address', uiKey: 'consigneeAddress', column: 'consigneeAddress', type: 'text' },
  { section: 'Key Dates', label: 'Cargo Ready Date', uiKey: 'crd', column: 'cargoReadyDate', type: 'date' },
  { section: 'Key Dates', label: 'CFS Cut-off', uiKey: 'cfsCutoff', column: 'cfsCutoff', type: 'date' },
  { section: 'Key Dates', label: 'ETD', uiKey: 'etd', column: 'etd', type: 'date' },
  { section: 'Key Dates', label: 'ATD', uiKey: 'actualDeparture', column: 'atd', type: 'date' },
  { section: 'Key Dates', label: 'ETA', uiKey: 'eta', column: 'eta', type: 'date' },
  { section: 'Key Dates', label: 'ATA', uiKey: 'actualArrival', column: 'ata', type: 'date' },
  { section: 'Key Dates', label: 'WH Start Date', uiKey: 'warehouseStartDate', column: 'warehouseStartDate', type: 'date' },
  { section: 'Key Dates', label: 'WH End Date', uiKey: 'warehouseEndDate', column: 'warehouseEndDate', type: 'date' },
  { section: 'Key Dates', label: 'In DC Date', uiKey: 'inDcDate', column: 'inDcDate', type: 'date' },
]

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

/** '4483262/LKN18360L15, LKN1794' → [{po:'4483262', style:'LKN18360L15'}, {po:'', style:'LKN1794'}] */
export function parseStyleEntries(value: string | null | undefined): StyleEntry[] {
  if (!value) return []
  return String(value)
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

/** Inverse of parseStyleEntries — empty rows dropped, 'po/style' or bare style, comma-joined. */
export function serializeStyleEntries(rows: StyleEntry[]): string {
  return rows
    .map((r) => ({ po: r.po.trim(), style: r.style.trim() }))
    .filter((r) => r.po || r.style)
    .map((r) => (r.po ? `${r.po}/${r.style || ''}`.replace(/\/$/, '') : r.style))
    .join(', ')
}

const COLUMN_SET = new Set(EDITABLE_FIELDS.map((f) => f.column))
const snakeToCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

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
