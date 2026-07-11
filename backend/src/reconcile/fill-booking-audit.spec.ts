import { describe, it, expect } from 'vitest'
import { AUDITED_BOOKING_FILL_FIELDS, isAuditedBookingFill } from './fill-booking-audit'

describe('fill-booking audit policy (rule 5 remainder)', () => {
  it('audits brand only among booking fills (not UUID master links)', () => {
    expect(AUDITED_BOOKING_FILL_FIELDS).toEqual(['brand'])
    expect(isAuditedBookingFill('brand')).toBe(true)
    expect(isAuditedBookingFill('customerId')).toBe(false)
    expect(isAuditedBookingFill('vendorId')).toBe(false)
    expect(isAuditedBookingFill('forwarderId')).toBe(false)
    expect(isAuditedBookingFill('crd')).toBe(false)
  })
})
