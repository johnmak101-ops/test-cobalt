import { describe, it, expect } from 'vitest'
import {
  isNonIdentifiableCandidate,
  isNonIdentifier,
  isUsableIdentifier,
  nonIdentifierValues,
} from './identifier-shape'

/**
 * A spreadsheet was parsed with its header row treated as data, and two cells became shipment legs on
 * the dev DB: SO `SO no.` (DEEC1FC0) and SO `PORT OF LOADING` (01B94D12). Both provisional, both
 * carrying four emails, and both offered to operators as legs to merge into.
 */
describe('isNonIdentifier — a shipment number with no digit is not a shipment number', () => {
  it('catches the two real header cells', () => {
    expect(isNonIdentifier('SO no.')).toBe(true)
    expect(isNonIdentifier('PORT OF LOADING')).toBe(true)
  })

  it('leaves every real identifier alone', () => {
    for (const v of ['FENLSO003044', 'TN#1075317470#BKG', 'FCR001379073', 'MRSU4743377', 'S13784413']) {
      expect(isNonIdentifier(v)).toBe(false)
      expect(isUsableIdentifier(v)).toBe(true)
    }
  })

  it('absent is not the same as malformed', () => {
    expect(isNonIdentifier('')).toBe(false)
    expect(isNonIdentifier('   ')).toBe(false)
    expect(isNonIdentifier(null)).toBe(false)
    expect(isUsableIdentifier(null)).toBe(false)
  })
})

describe('isNonIdentifiableCandidate', () => {
  it('rejects a candidate whose only identifier is a header', () => {
    expect(isNonIdentifiableCandidate({ so_no: 'SO no.' })).toBe(true)
    expect(isNonIdentifiableCandidate({ so_no: 'PORT OF LOADING' })).toBe(true)
  })

  it('keeps a candidate with any usable identifier', () => {
    expect(isNonIdentifiableCandidate({ so_no: 'SO no.', booking_no: 'TN1075317470' })).toBe(false)
    expect(isNonIdentifiableCandidate({ hbl_awb_fcr_no: 'FCR001379073' })).toBe(false)
  })

  /** Thin is not junk: a leg with no identifiers may still be matched by PO. */
  it('keeps a candidate that offers no identifiers at all', () => {
    expect(isNonIdentifiableCandidate({})).toBe(false)
    expect(isNonIdentifiableCandidate({ so_no: null, booking_no: '' })).toBe(false)
  })

  it('names the offending values for the copy', () => {
    expect(nonIdentifierValues({ so_no: 'SO no.', hbl_awb_fcr_no: 'FCR001379073' })).toEqual(['SO no.'])
  })
})
