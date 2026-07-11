/**
 * Rule 5 (change-history completeness) — which booking-only fills get an audit row on fillBooking.
 * UUID master links (customer/vendor/forwarder) are intentionally NOT audited (noise); brand is the
 * human-readable booking-only field that must appear in shipment change-history.
 */
export const AUDITED_BOOKING_FILL_FIELDS = ['brand'] as const

export type AuditedBookingFillField = (typeof AUDITED_BOOKING_FILL_FIELDS)[number]

export function isAuditedBookingFill(field: string): boolean {
  return (AUDITED_BOOKING_FILL_FIELDS as readonly string[]).includes(field)
}
