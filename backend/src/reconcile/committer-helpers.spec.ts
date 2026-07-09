import { describe, it, expect } from 'vitest'
import { dedupeCsv, scacFromMbl, countryToIso2 } from './committer-helpers'

describe('scacFromMbl — carrier SCAC = leading 4 letters of the master B/L', () => {
  it('takes the 4-letter carrier prefix (follow char may be a letter OR a digit)', () => {
    expect(scacFromMbl('MEDUP5180997')).toBe('MEDU') // MSC — follow char is a LETTER (the bug this guards)
    expect(scacFromMbl('MAEU5123456')).toBe('MAEU') // Maersk — follow char a digit
  })
  it('returns null for a separator-bearing house routing ref (only 3 letters before the -)', () => {
    expect(scacFromMbl('HUN-HKG-FXT-001')).toBeNull()
  })
  it('uppercases input, and returns null for null / <4 letters', () => {
    expect(scacFromMbl('meduP5180997')).toBe('MEDU')
    expect(scacFromMbl(null)).toBeNull()
    expect(scacFromMbl('ABC')).toBeNull()
  })
})

describe('dedupeCsv — order-preserving, case-insensitive comma-list dedupe', () => {
  it('drops case-insensitive duplicates, keeping first-seen order + original casing', () => {
    expect(dedupeCsv('A, b, a, B, c')).toBe('A,b,c')
  })
  it('passes a non-list or null through unchanged', () => {
    expect(dedupeCsv('single')).toBe('single')
    expect(dedupeCsv(null)).toBeNull()
  })
})

describe('countryToIso2 — spelled-out origin country → ISO-2 (exact uppercase key)', () => {
  it('maps known origin countries', () => {
    expect(countryToIso2('BANGLADESH')).toBe('BD')
    expect(countryToIso2('SRI LANKA')).toBe('LK')
    expect(countryToIso2('CHINA')).toBe('CN')
  })
  it('returns null for a non-uppercase or unknown name', () => {
    expect(countryToIso2('bangladesh')).toBeNull()
    expect(countryToIso2('NARNIA')).toBeNull()
  })
})
