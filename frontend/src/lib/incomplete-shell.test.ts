import { describe, expect, it } from 'vitest'
import { isIncompleteShell, hasStrongShipmentKey, hasMasterParty } from './incomplete-shell'

describe('isIncompleteShell', () => {
  it('true when no strong key and no master', () => {
    expect(isIncompleteShell({ poNumbers: 'PO1' } as never)).toBe(true)
    expect(isIncompleteShell({})).toBe(true)
  })

  it('false when booking / so / hbl present', () => {
    expect(hasStrongShipmentKey({ bookingNo: 'BK1' })).toBe(true)
    expect(isIncompleteShell({ bookingNo: 'BK1' })).toBe(false)
    expect(isIncompleteShell({ soNumber: 'SO1' })).toBe(false)
    expect(isIncompleteShell({ hblNumber: 'GZL1' })).toBe(false)
    expect(isIncompleteShell({ containerNo: 'MSCU1' })).toBe(false)
  })

  it('false when master party resolved', () => {
    expect(hasMasterParty({ customerId: 'c1' })).toBe(true)
    expect(isIncompleteShell({ customer: { name: 'Acme' } })).toBe(false)
    expect(isIncompleteShell({ forwarderId: 'f1' })).toBe(false)
  })
})
