import { describe, it, expect } from 'vitest'
import { guardVendorForwarder, isPlatformNotForwarder, type GuardInput } from './vendor-forwarder-guard'

describe('isPlatformNotForwarder — CVP portal is never the forwarder', () => {
  it('matches the TradeLink platform in every observed spelling', () => {
    expect(isPlatformNotForwarder('TRADELINK TECHNOLOGIES LIMITED')).toBe(true)
    expect(isPlatformNotForwarder('TradeLink Technologies Ltd (TradeLinkOne portal)')).toBe(true)
    expect(isPlatformNotForwarder('TradeLink Technologies Ltd (notify.noreply3@tradelinkone.com)')).toBe(true)
  })
  it('never matches real forwarders or empties', () => {
    expect(isPlatformNotForwarder('MAERSK LOGISTICS & SERVICES CHINA LIMITED')).toBe(false)
    expect(isPlatformNotForwarder('EXPEDITORS INTERNATIONAL')).toBe(false)
    expect(isPlatformNotForwarder(null)).toBe(false)
  })
})

const base = (over: Partial<GuardInput> = {}): GuardInput => ({
  vendorCode: 'ROKNFT',
  vendorId: 'ven-1',
  forwarderId: null,
  forwarderIdForVendorCode: null,
  approvedKeys: new Set<string>(),
  ...over,
})

describe('guardVendorForwarder — forwarder-as-vendor misclassification guard', () => {
  it('leaves a clean vendor untouched (no forwarder signal)', () => {
    const r = guardVendorForwarder(base())
    expect(r.misclassified).toBe(false)
    expect(r.vendorId).toBe('ven-1')
    expect(r.forwarderId).toBeNull()
    expect(r.reasons).toEqual([])
  })

  it('L1: when the vendor_code resolves to a forwarder, it un-links the vendor and routes to review', () => {
    const r = guardVendorForwarder(base({ vendorCode: 'DSV', forwarderIdForVendorCode: 'fwd-9' }))
    expect(r.misclassified).toBe(true)
    expect(r.vendorId).toBeNull()
    expect(r.reasons[0]).toMatch(/forwarder/i)
  })

  it('L1: fills the empty forwarder slot with the matched forwarder (link only, never a new master)', () => {
    const r = guardVendorForwarder(base({ vendorCode: 'DSV', vendorId: 'ven-x', forwarderId: null, forwarderIdForVendorCode: 'fwd-9' }))
    expect(r.vendorId).toBeNull()
    expect(r.forwarderId).toBe('fwd-9')
  })

  it('L1: does NOT overwrite a separately-extracted forwarder', () => {
    const r = guardVendorForwarder(base({ vendorCode: 'DSV', forwarderId: 'fwd-real', forwarderIdForVendorCode: 'fwd-9' }))
    expect(r.forwarderId).toBe('fwd-real')
  })

  it('L3: an approved forwarder_ref fact flags misclassification even without a forwarder master hit', () => {
    const r = guardVendorForwarder(base({ vendorCode: 'EXPED', approvedKeys: new Set(['forwarder_ref:EXPED']) }))
    expect(r.misclassified).toBe(true)
    expect(r.vendorId).toBeNull()
  })

  it('L3: an approved vendor_name_marker OVERRIDES a forwarder-name false-positive (real vendor stays)', () => {
    const r = guardVendorForwarder(
      base({ vendorCode: 'OCEAN', vendorId: 'ven-ocean', forwarderIdForVendorCode: 'fwd-ocean', approvedKeys: new Set(['vendor_name_marker:OCEAN']) }),
    )
    expect(r.misclassified).toBe(false)
    expect(r.vendorId).toBe('ven-ocean')
  })

  it('is a no-op when there is no vendor_code', () => {
    const r = guardVendorForwarder(base({ vendorCode: null, vendorId: null }))
    expect(r.misclassified).toBe(false)
    expect(r.vendorId).toBeNull()
  })
})
