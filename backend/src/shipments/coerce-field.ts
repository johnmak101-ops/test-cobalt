import { BadRequestException } from '@nestjs/common'
import { QTY_UNIT, SHIPMENT_MODE } from '../db/enums'

/** Leg columns coerced to a Date. */
export const DATE_FIELDS = new Set([
  'cargoReadyDate', 'cfsCutoff', 'warehouseStartDate', 'warehouseEndDate',
  'etd', 'atd', 'eta', 'ata', 'inDcDate',
])

/** Leg columns coerced to a number. */
export const NUMERIC_FIELDS = new Set(['qty', 'grossWeight', 'measurement'])

/** Numeric columns that are a physical COUNT — must be a whole number > 0 (cartons / pieces). */
const COUNT_FIELDS = new Set(['qty'])

/** Human-facing names for the gate's 400 messages (backend has no access to the frontend label map). */
const LABELS: Record<string, string> = {
  qty: 'Total Quantity',
  grossWeight: 'Gross Weight',
  measurement: 'Measurement',
}

/** SCAC = Standard Carrier Alpha Code: 2-4 letters. */
const SCAC_RE = /^[A-Za-z]{2,4}$/
/** Container = ISO 6346 shape: 4 letters (owner + U/J/Z category) + 7 digits (6 serial + 1 check). */
const CONTAINER_RE = /^[A-Za-z]{4}\d{7}$/

/**
 * Coerce a HUMAN-entered value to its leg column's type, and sanity-gate numerics.
 *
 *   - '' / null       → null (clears the field)
 *   - date column     → Date  (unparseable → null)
 *   - numeric column  → number; REJECTS negatives, and non-positive / non-integer counts
 *   - anything else   → String(value)
 *
 * Throws {@link BadRequestException} on an out-of-range numeric. This runs ONLY on the manual EDIT
 * path (Order Details `PATCH /shipments/:id` + Review `POST /correct`), so blocking a typed `-10` is
 * ordinary input validation — NOT correcting the agent (the parser/committer never comes through here,
 * per the de-correction principle). Non-numeric junk in a numeric field still degrades to null, since
 * the number `<input>` already blocks that at entry and there is no value worth surfacing.
 */
export function coerceLegField(field: string, value: unknown): unknown {
  if (value == null || value === '') return null
  if (DATE_FIELDS.has(field)) {
    const d = new Date(String(value))
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    const label = LABELS[field] ?? field
    if (n < 0) throw new BadRequestException(`${label} cannot be negative`)
    if (COUNT_FIELDS.has(field) && (n === 0 || !Number.isInteger(n))) {
      throw new BadRequestException(`${label} must be a whole number greater than 0`)
    }
    return n
  }
  const text = String(value)
  // Format gates for fields with a well-defined shape. Human edit path only (see above), so a
  // malformed value is a person's typo — the agent's committer writes never reach here. HTS is
  // deliberately NOT gated: its forms vary (6/8/10-digit, dotted like 6110.20.2020), so it is a
  // frontend warning, not a backend reject.
  if (field === 'scacCode' && !SCAC_RE.test(text)) {
    throw new BadRequestException('SCAC Code must be 2–4 letters (e.g. MAEU)')
  }
  if (field === 'containerNo' && !CONTAINER_RE.test(text)) {
    throw new BadRequestException('Container No. must be 4 letters + 7 digits, e.g. MSBU7281200')
  }
  // Enum gates mirror ck_shipments_qty_unit / mode CHECK constraints (exact / case-sensitive).
  // Human edit path only — agent committer never hits coerceLegField (de-correction preserved).
  if (field === 'qtyUnit') {
    if (!(QTY_UNIT as readonly string[]).includes(text)) {
      throw new BadRequestException(`UOM must be one of: ${QTY_UNIT.join(', ')}`)
    }
    return text
  }
  if (field === 'mode') {
    if (!(SHIPMENT_MODE as readonly string[]).includes(text)) {
      throw new BadRequestException(`Mode must be one of: ${SHIPMENT_MODE.join(', ')}`)
    }
    return text
  }
  return text
}
