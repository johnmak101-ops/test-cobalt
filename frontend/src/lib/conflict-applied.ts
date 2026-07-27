/**
 * "The email already got what it asked for."
 *
 * ShipTrack commits first: the committer writes an email's values onto the leg, and the critic payload
 * that describes the disagreement is a snapshot taken BEFORE that write. So a row can be listed as
 * contested — `System: MAASTRICHT MAERSK` vs `Draft B/L: MARIBO MAERSK` — when the leg has said
 * MARIBO MAERSK for hours. The review desk then asks the operator to settle a question that is closed,
 * shows them a stale value in the Current column, and offers an Apply that writes a no-op.
 *
 * Measured on the live dev queue (2026-07-27): **41 of 41** checkable conflict rows were in exactly
 * this state — consignee_name 12/12, vessel_name 9/9, consignee_address 8/8, voyage_no 7/7,
 * booking_no 3/3, so_no 2/2. Every single field decision on the desk was already made.
 *
 * `qty` already had this cure (qty-conflict-settle.ts) because the 260-cartons-vs-13516-pieces family
 * forced the issue. This is the same idea for every column the desk can write.
 *
 * The rule is deliberately strict: a row settles only when EVERY value the email offered is already
 * what the leg stores. One candidate that matches while another disagrees is still a live question
 * ("which of these three vendors?"), and hiding it would answer it for the operator.
 */
import type { CriticConflict } from './critic-review'
import { isDateColumn, isNumericColumn, mapCriticFieldToColumn } from './review-fields'
import { resolutionValueOf } from '../components/review/ConflictRow'

/**
 * Leg column → the field that carries its LIVE value on the shipment DTO.
 *
 * Not an identity map, which is the whole reason this exists as a table: the wire DTO says `soNumber`
 * for `soNo`, `voyageNumber` for `voyageNo`, `hblNumber` for `hblAwbFcrNo`, `quantityShipped` for
 * `qty`, `actualDeparture` for `atd`. Reading `leg[column]` would silently return undefined for those
 * and quietly settle nothing — the failure mode is invisible, so the mapping is explicit.
 *
 * A column absent from this map never settles. That is the safe direction: the row stays on the desk.
 */
const COLUMN_TO_DTO_FIELD: Record<string, string> = {
  bookingNo: 'bookingNo',
  soNo: 'soNumber',
  itemStyleNo: 'itemStyleNo',
  qty: 'quantityShipped',
  qtyUnit: 'quantityUnit',
  grossWeight: 'grossWeight',
  measurement: 'measurement',
  htsCode: 'htsCode',
  containerNo: 'containerNo',
  hblAwbFcrNo: 'hblNumber',
  mbl: 'mblNumber',
  scacCode: 'scacCode',
  consigneeName: 'consigneeName',
  consigneeAddress: 'consigneeAddress',
  vesselName: 'vesselName',
  voyageNo: 'voyageNumber',
  cargoReadyDate: 'crd',
  cfsCutoff: 'cfsCutoff',
  etd: 'etd',
  atd: 'actualDeparture',
  eta: 'eta',
  ata: 'actualArrival',
  warehouseStartDate: 'warehouseStartDate',
  warehouseEndDate: 'warehouseEndDate',
  inDcDate: 'inDcDate',
  mode: 'mode',
  polRaw: 'polRaw',
  podRaw: 'podRaw',
  forwarderRaw: 'forwarderRaw',
  customerRaw: 'customerRaw',
  vendorRaw: 'vendorRaw',
  flightNo: 'flightNo',
  mawb: 'mawb',
}

/** The leg's current value for a critic field, or null when the DTO does not carry it. */
export function liveValueForField(
  conflict: CriticConflict,
  leg: Record<string, unknown> | null | undefined,
): string | null {
  if (!leg) return null
  const column = mapCriticFieldToColumn(conflict.field)
  if (!column) return null
  const dtoField = COLUMN_TO_DTO_FIELD[column]
  if (!dtoField) return null
  const raw = leg[dtoField]
  if (raw == null || raw === '') return null
  return String(raw)
}

function normalizeText(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Day precision: the leg stores an instant, the email stated a date. 'T' or a space splits both. */
function normalizeDay(v: string): string | null {
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function normalizeNumber(v: string): number | null {
  const m = v.trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Same value, allowing for the formatting differences between a leg column and an email's prose. */
export function sameStoredValue(column: string, a: string, b: string): boolean {
  if (isDateColumn(column)) {
    const da = normalizeDay(a)
    const db = normalizeDay(b)
    // A date we cannot parse falls back to text: better a missed settle than a wrong one.
    if (da != null && db != null) return da === db
  }
  if (isNumericColumn(column)) {
    const na = normalizeNumber(a)
    const nb = normalizeNumber(b)
    if (na != null && nb != null) return na === nb
  }
  return normalizeText(a) === normalizeText(b)
}

/**
 * Every value this email offered is already on the leg → the row has nothing left to decide.
 *
 * Each candidate is checked against BOTH its raw text and its resolution value (the master CODE for a
 * resolved party), because either could be what the committer wrote — `vendorRaw` may hold `JINGSC`
 * or the full company name depending on which path stored it.
 */
export function isAppliedToLeg(
  conflict: CriticConflict,
  leg: Record<string, unknown> | null | undefined,
): boolean {
  const column = mapCriticFieldToColumn(conflict.field)
  if (!column) return false
  const live = liveValueForField(conflict, leg)
  if (live == null) return false

  const offered = conflict.candidates.filter((c) => c.source.trim().toLowerCase() !== 'system')
  if (offered.length === 0) return false

  return offered.every((c) => {
    const raw = String(c.value ?? '').trim()
    if (raw !== '' && sameStoredValue(column, raw, live)) return true
    const resolved = resolutionValueOf(c).trim()
    return resolved !== '' && sameStoredValue(column, resolved, live)
  })
}

/** Split a conflict set into what still needs a decision and what the leg already satisfies. */
export function partitionAppliedConflicts(
  conflicts: CriticConflict[],
  leg: Record<string, unknown> | null | undefined,
): { open: CriticConflict[]; applied: CriticConflict[] } {
  const open: CriticConflict[] = []
  const applied: CriticConflict[] = []
  for (const c of conflicts) {
    if (isAppliedToLeg(c, leg)) applied.push(c)
    else open.push(c)
  }
  return { open, applied }
}
