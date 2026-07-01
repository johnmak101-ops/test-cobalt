/** Derive the unified 6-state staircase from the signals present (highest reached wins). */

const ORDER = ['BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED'] as const
export type ShipmentState = (typeof ORDER)[number]

const has = (v: unknown) => v != null && v !== ''

export function deriveState(emailTypes: Set<string>, fields: Record<string, unknown>): ShipmentState {
  let s: ShipmentState = 'BOOKED'
  const bump = (to: ShipmentState) => {
    if (ORDER.indexOf(to) > ORDER.indexOf(s)) s = to
  }
  if (emailTypes.has('SO') || has(fields.so_no)) bump('CONFIRMED')
  // AT_WAREHOUSE = earliest of forwarder CFS / vendor warehouse confirm / Draft B/L (fallback)
  if (has(fields.warehouse_start_date) || emailTypes.has('Draft B/L')) bump('AT_WAREHOUSE')
  if (has(fields.atd)) bump('SAILED')
  if (emailTypes.has('Telex Release') || emailTypes.has('Final B/L')) bump('RELEASED')
  // A delivery cannot precede departure: only bump to DELIVERED when there is also a departure signal.
  if (has(fields.in_dc_date) && (has(fields.atd) || emailTypes.has('Final B/L') || emailTypes.has('Telex Release'))) bump('DELIVERED')
  return s
}

/** Which milestone an email type records (null = no milestone). */
export const MILESTONE_OF: Record<string, string> = {
  'Booking Request': 'BOOKING_SENT',
  SO: 'SO_RECEIVED',
  'Draft B/L': 'DRAFT_BL_RECEIVED',
  'Final B/L': 'FINAL_BL_RECEIVED',
  'Telex Release': 'TELEX_RELEASED',
  'Invoice/Billing': 'INVOICE_RECEIVED',
}

/** Normalize the parser's mode label to the schema enum. */
export function normMode(mode: string | null): string | null {
  if (!mode) return null
  const m: Record<string, string> = { Sea: 'SEA', 'Sea-FCL': 'SEA_FCL', 'Sea-LCL': 'SEA_LCL', Air: 'AIR' }
  if (m[mode]) return m[mode]
  if (mode.toLowerCase().startsWith('sea')) return 'SEA'
  if (mode.toLowerCase().startsWith('air')) return 'AIR'
  return null
}
