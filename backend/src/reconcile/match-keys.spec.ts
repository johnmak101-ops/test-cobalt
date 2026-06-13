import { describe, it, expect } from 'vitest'
import { normKey, strongKeys, keysOverlap, mergeKeys, str, num, date } from './match-keys'

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
