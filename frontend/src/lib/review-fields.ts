/**
 * The parser's 20-field model (`evidence.parsed_record.fields`) as the review queue presents it:
 * field labels, section grouping, value formatters, and the diff/section helpers shared by every
 * review-queue data view. Keeping this in one place is what lets the views stay thin and consistent.
 */

export const FIELD_LABELS: Record<string, string> = {
  customer_code: 'Customer Code',
  customer_po: 'Customer PO',
  vendor_code: 'Vendor Code',
  item_style_no: 'Item / Style No.',
  booking_no: 'Booking No.',
  so_no: 'SO #',
  hbl_awb_fcr_no: 'HBL / AWB / FCR',
  mbl: 'MBL',
  container_no: 'Container No.',
  forwarder_name: 'Forwarder',
  consignee_name: 'Consignee',
  consignee_address: 'Consignee Address',
  cargo_ready_date: 'Cargo Ready Date',
  warehouse_start_date: 'WH Start Date',
  warehouse_end_date: 'WH Cut-off',
  etd: 'ETD',
  atd: 'ATD',
  eta: 'ETA',
  in_dc_date: 'In DC Date',
  qty: 'Qty',
  poi: 'POL (origin)',
  pod: 'POD (destination)',
}

export const FIELD_SECTIONS: Record<string, string[]> = {
  'Order Info': ['customer_code', 'customer_po', 'vendor_code', 'item_style_no', 'booking_no', 'so_no'],
  'Cargo & Logistics': ['qty', 'container_no', 'hbl_awb_fcr_no', 'mbl', 'forwarder_name', 'poi', 'pod'],
  'Parties': ['consignee_name', 'consignee_address'],
  'Dates': ['cargo_ready_date', 'warehouse_start_date', 'warehouse_end_date', 'etd', 'atd', 'eta', 'in_dc_date'],
}

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field

export function hasValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

/** Display form of a parsed value (dates → "12 Feb 2026", arrays → joined, null → "—"). */
export function formatExtractedValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.join(', ') || '—'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  return String(value)
}

/** Raw form for an editable input (no date prettifying; null/array normalised to a string). */
export function formatRawValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** Keys whose *displayed* value differs between two records — the basis of every diff badge/row. */
export function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>): Set<string> {
  const out = new Set<string>()
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (formatExtractedValue(a[k]) !== formatExtractedValue(b[k])) out.add(k)
  }
  return out
}

/** FIELD_SECTIONS reduced to the sections (and fields) that pass `include`, dropping empty sections. */
export function sectionsWith(include: (field: string) => boolean): { title: string; fields: string[] }[] {
  return Object.entries(FIELD_SECTIONS)
    .map(([title, fields]) => ({ title, fields: fields.filter(include) }))
    .filter((s) => s.fields.length > 0)
}
