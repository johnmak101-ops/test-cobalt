/**
 * PR-P5 (parse-identity): incomplete "shell" legs — no strong booking key and no master parties.
 * Used by Shipment Tracker count chip so shells are never silently hidden without a visible count.
 */

export type ShellShipmentLike = {
  bookingNo?: string | null
  soNumber?: string | null
  hblNumber?: string | null
  mblNumber?: string | null
  mawb?: string | null
  containerNo?: string | null
  customerId?: string | null
  vendorId?: string | null
  forwarderId?: string | null
  customer?: { name?: string | null } | null
  vendor?: { name?: string | null } | null
  forwarder?: { name?: string | null } | null
}

function hasText(v: unknown): boolean {
  return v != null && String(v).trim() !== ''
}

/** Strong identity for list purposes (booking / SO / HBL / MBL / MAWB / container). */
export function hasStrongShipmentKey(s: ShellShipmentLike): boolean {
  return (
    hasText(s.bookingNo) ||
    hasText(s.soNumber) ||
    hasText(s.hblNumber) ||
    hasText(s.mblNumber) ||
    hasText(s.mawb) ||
    hasText(s.containerNo)
  )
}

/** Mesh / party masters (resolved id or name). */
export function hasMasterParty(s: ShellShipmentLike): boolean {
  return (
    hasText(s.customerId) ||
    hasText(s.vendorId) ||
    hasText(s.forwarderId) ||
    hasText(s.customer?.name) ||
    hasText(s.vendor?.name) ||
    hasText(s.forwarder?.name)
  )
}

/** Incomplete shell: no strong key ∧ no master fields (design P5 criteria). */
export function isIncompleteShell(s: ShellShipmentLike): boolean {
  return !hasStrongShipmentKey(s) && !hasMasterParty(s)
}
