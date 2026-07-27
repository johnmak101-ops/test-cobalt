import { describe, it, expect } from 'vitest'
import { normAwbKey, normKey, strongKeys, keysOverlap, mergeKeys, str, num, date } from './match-keys'

/**
 * The bare-`A` AWB alias. One forwarder writes `BL#A26050003` in the email subject while the B/L attachment
 * says `SZA26050003`; they are the same air waybill. Before this collapsed, a decision carrying the long form
 * could not find a leg committed under the short one, and the committer minted a duplicate shipment
 * (JOB-2026-0010 beside JOB-2026-0003, live on 2026-07-26).
 */
describe('normAwbKey — AWB alias collapse (must mirror cobalt-queue normalizeAwbToken)', () => {
  it('folds the bare-A subject form onto the SZA form', () => {
    expect(normAwbKey('A26050003')).toBe('SZA26050003')
    expect(normAwbKey('SZA26050003')).toBe('SZA26050003')
    expect(normAwbKey('BL#A26050003')).toBe('SZA26050003')
    expect(normAwbKey('bl# sza-26050003')).toBe('SZA26050003')
  })

  it('leaves other carrier prefixes alone', () => {
    expect(normAwbKey('GZL26258522')).toBe('GZL26258522')
    expect(normAwbKey('SNZ260004243')).toBe('SNZ260004243')
    expect(normAwbKey('GZOSA2600021')).toBe('GZOSA2600021')
  })

  it('requires at least 6 digits, so a short A-token is not silently re-prefixed', () => {
    expect(normAwbKey('A12345')).toBe('A12345')
    expect(normAwbKey('A123456')).toBe('SZA123456')
  })

  it('returns null for empty or too-short input, so callers can fall back to normKey', () => {
    expect(normAwbKey(null)).toBeNull()
    expect(normAwbKey('')).toBeNull()
    expect(normAwbKey('---')).toBeNull()
    expect(normAwbKey('AB1')).toBeNull()
  })
})

describe('strongKeys — the HBL alias must reach the key set (and thus shipment_match_keys)', () => {
  it('yields ONE key for both spellings, so short-form and long-form legs overlap', () => {
    const short = strongKeys({ hbl_awb_fcr_no: 'A26050003' })
    const long = strongKeys({ hbl_awb_fcr_no: 'SZA26050003' })
    expect([...short]).toEqual(['hbl_awb_fcr_no:SZA26050003'])
    expect(keysOverlap(short, long)).toBe(true)
  })

  it('does NOT make unrelated HBLs overlap', () => {
    expect(keysOverlap(strongKeys({ hbl_awb_fcr_no: 'GZL26258522' }), strongKeys({ hbl_awb_fcr_no: 'GZL26261147' }))).toBe(
      false,
    )
  })

  it('falls back to normKey rather than dropping an unjudgeable token', () => {
    expect([...strongKeys({ hbl_awb_fcr_no: 'X-1' })]).toEqual(['hbl_awb_fcr_no:X1'])
  })
})

describe('normKey', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normKey('hbl-123 /a')).toBe('HBL123A')
    expect(normKey(null)).toBe('')
  })
})

describe('strongKeys', () => {
  it('extracts rotation-resistant keys, ignores customer_po', () => {
    const k = strongKeys({ so_no: 'SO 1', booking_no: 'B1', customer_po: 'PO1', conversation_id: 'c1' })
    expect(k.has('so_no:SO1')).toBe(true)
    expect(k.has('booking_no:B1')).toBe(true)
    expect([...k].some((x) => x.startsWith('customer_po'))).toBe(false)
  })
  it('empty for null', () => {
    expect(strongKeys(null).size).toBe(0)
  })
})

describe('keysOverlap', () => {
  it('true when any key shared', () => {
    expect(keysOverlap(new Set(['so_no:A']), new Set(['mbl:B', 'so_no:A']))).toBe(true)
  })
  it('false when disjoint or empty', () => {
    expect(keysOverlap(new Set(['so_no:A']), new Set(['so_no:B']))).toBe(false)
    expect(keysOverlap(new Set(['so_no:A']), new Set())).toBe(false)
  })
})

describe('mergeKeys', () => {
  it('takes the first non-empty value per key across rows', () => {
    const m = mergeKeys([{ matchKeys: { so_no: '', booking_no: 'B1' } }, { matchKeys: { so_no: 'S2', hbl_awb_fcr_no: 'H3' } }])
    expect(m.booking_no).toBe('B1')
    expect(m.so_no).toBe('S2')
    expect(m.hbl_awb_fcr_no).toBe('H3')
  })
})

describe('coercions', () => {
  it('str trims and nulls empties', () => {
    expect(str('  x ')).toBe('x')
    expect(str('')).toBeNull()
    expect(str(null)).toBeNull()
  })
  it('num parses, strips noise, nulls bad', () => {
    expect(num('1,200 ctn')).toBe(1200)
    expect(num('')).toBeNull()
    expect(num('abc')).toBeNull()
  })
  it('date parses ISO, nulls bad', () => {
    expect(date('2026-02-03')?.toISOString().slice(0, 10)).toBe('2026-02-03')
    expect(date('not-a-date')).toBeNull()
    expect(date(null)).toBeNull()
  })
})
