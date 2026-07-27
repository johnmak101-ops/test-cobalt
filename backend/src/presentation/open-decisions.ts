/**
 * What is actually left for a human — the agent's advice MINUS what the commit already settled.
 *
 * `critic_review` is the queue's deliberation snapshot, taken BEFORE the committer acts, and the desk
 * has been rendering it as if it were the state of the leg. So it asked questions the pipeline had
 * already answered: on the dev queue, 41 of 41 checkable conflict rows carried a value the leg already
 * stored, and 13 master-miss lines named a party slot that was already linked to a master.
 *
 * The frontend grew six separate re-derivations of this, one per symptom. This is the single one, and
 * it lives here because only the backend holds both halves — the advice and the leg.
 *
 * COMPUTED ON READ rather than stored at commit. The redesign sketch said "compute once at commit",
 * but stored means stale the moment anything else touches the leg (a later email, a human edit, a
 * master syncing in), and the whole class of bug being fixed here IS staleness. It is a handful of
 * string comparisons over at most a few conflicts; correctness is worth more than the microseconds.
 */
import type { CriticReview } from '../decisions/critic-review.types'

/** Critic conflict field → the leg column that holds it. Server-side these ARE the leg's own columns. */
const FIELD_TO_COLUMN: Record<string, string> = {
  booking_no: 'bookingNo',
  so_no: 'soNo',
  hbl_awb_fcr_no: 'hblAwbFcrNo',
  mbl: 'mbl',
  container_no: 'containerNo',
  scac_code: 'scacCode',
  vessel_name: 'vesselName',
  voyage_no: 'voyageNo',
  consignee_name: 'consigneeName',
  consignee_address: 'consigneeAddress',
  qty: 'qty',
  qty_unit: 'qtyUnit',
  cargo_ready_date: 'cargoReadyDate',
  cfs_cutoff: 'cfsCutoff',
  etd: 'etd',
  atd: 'atd',
  eta: 'eta',
  ata: 'ata',
  warehouse_start_date: 'warehouseStartDate',
  warehouse_end_date: 'warehouseEndDate',
  in_dc_date: 'inDcDate',
  mode: 'mode',
  pol: 'polRaw',
  pod: 'podRaw',
  forwarder_name: 'forwarderRaw',
  customer_code: 'customerRaw',
  vendor_code: 'vendorRaw',
  flight_no: 'flightNo',
  mawb: 'mawb',
}

const DATE_COLUMNS = new Set([
  'cargoReadyDate', 'cfsCutoff', 'etd', 'atd', 'eta', 'ata',
  'warehouseStartDate', 'warehouseEndDate', 'inDcDate',
])
const NUMERIC_COLUMNS = new Set(['qty', 'grossWeight', 'measurement', 'netWeight', 'cartons'])

const text = (v: unknown): string => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase()

/** Day precision: the leg stores an instant, the email stated a date. */
function day(v: unknown): string | null {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '')
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function num(v: unknown): number | null {
  const m = String(v ?? '').trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Same value, allowing for the formatting gap between a leg column and an email's prose. */
export function sameStoredValue(column: string, a: unknown, b: unknown): boolean {
  if (DATE_COLUMNS.has(column)) {
    const da = day(a)
    const db = day(b)
    if (da != null && db != null) return da === db
  }
  if (NUMERIC_COLUMNS.has(column)) {
    const na = num(a)
    const nb = num(b)
    if (na != null && nb != null) return na === nb
  }
  return text(a) === text(b)
}

/**
 * Every value this email offered for the field is already what the leg stores.
 *
 * Strict on purpose: one candidate agreeing while another disagrees is still a live question ("which
 * of these three vendors?"), and settling it would answer it for the operator.
 */
function conflictIsSettled(
  conflict: { field: string; candidates?: { value?: string; source?: string; master?: { code?: string } | null }[] },
  leg: Record<string, unknown>,
): boolean {
  const column = FIELD_TO_COLUMN[conflict.field]
  if (!column) return false
  const live = leg[column]
  if (live == null || live === '') return false

  const offered = (conflict.candidates ?? []).filter(
    (c) => String(c.source ?? '').trim().toLowerCase() !== 'system',
  )
  if (offered.length === 0) return false

  return offered.every((c) => {
    const raw = String(c.value ?? '').trim()
    if (raw !== '' && sameStoredValue(column, raw, live)) return true
    // A resolved party may have been stored as the master CODE rather than the name.
    const code = c.master?.code ? String(c.master.code).trim() : ''
    return code !== '' && sameStoredValue(column, code, live)
  })
}

export type OpenDecisions = {
  /** Conflict fields the leg already satisfies — the desk shows these as settled, not as a diff. */
  settledFields: string[]
  /** Party slots linked to a master, with that master's name — a miss line naming one is stale. */
  resolvedParties: { slot: 'customer' | 'vendor' | 'forwarder'; name: string }[]
  /**
   * What the leg ACTUALLY stores for each contested field, keyed by the critic's field name.
   *
   * The grid's "Current" column used to print the critic's `System` candidate, which is a pre-commit
   * snapshot — so a row could read `MAASTRICHT MAERSK` while the shipment had said `MARIBO MAERSK` for
   * hours, and the operator was comparing the email against a value nobody stored any more.
   */
  liveValues: Record<string, string>
}

/**
 * @param leg  the leg row AS STORED (camelCase columns), read after the commit
 * @param parties  resolved master names, only for slots that carry a master id
 */
export function openDecisions(
  leg: Record<string, unknown>,
  criticReview: CriticReview | null | undefined,
  parties: { customer?: string | null; vendor?: string | null; forwarder?: string | null },
): OpenDecisions {
  const conflicts = (criticReview?.conflicts ?? []) as {
    field: string
    candidates?: { value?: string; source?: string; master?: { code?: string } | null }[]
  }[]
  const settledFields = conflicts.filter((c) => conflictIsSettled(c, leg)).map((c) => c.field)

  const resolvedParties: OpenDecisions['resolvedParties'] = []
  for (const slot of ['customer', 'vendor', 'forwarder'] as const) {
    const name = (parties[slot] ?? '').trim()
    if (name) resolvedParties.push({ slot, name })
  }

  const liveValues: Record<string, string> = {}
  for (const c of conflicts) {
    const column = FIELD_TO_COLUMN[c.field]
    if (!column) continue
    const v = leg[column]
    if (v == null || v === '') continue
    liveValues[c.field] = v instanceof Date ? v.toISOString() : String(v)
  }

  return { settledFields, resolvedParties, liveValues }
}
