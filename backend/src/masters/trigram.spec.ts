import { describe, it, expect } from 'vitest'
import { trigrams, trigramSimilarity } from './trigram'

describe('trigramSimilarity (pg_trgm-compatible)', () => {
  it('is 1 for identical strings (case/punctuation-insensitive)', () => {
    expect(trigramSimilarity('MACAU FUNG TAI', 'macau fung tai')).toBe(1)
    expect(trigramSimilarity('A.B. Corp', 'a b corp')).toBe(1)
  })
  it('scores close variants well above the 0.3 threshold', () => {
    expect(trigramSimilarity('MACAU FUNG TAI LTD', 'MACAU FUNG TAI CO LTD')).toBeGreaterThan(0.6)
    expect(trigramSimilarity('EXPEDITORS', 'EXPEDITORS INTERNATIONAL')).toBeGreaterThan(0.3)
    // heavy spelling drift (Chittagong→Chattogram) scores LOW (~0.1) — exactly the class of pair the
    // prior_correction signal / curated aliases exist to cover, not the trigram tier.
    expect(trigramSimilarity('Chittagong', 'Chattogram')).toBeLessThan(0.3)
  })
  it('scores unrelated names near zero', () => {
    expect(trigramSimilarity('MACAU FUNG TAI', 'ROYAL KNITWEAR FACTORY')).toBeLessThan(0.12)
  })
  it('handles empty / symbol-only inputs safely', () => {
    expect(trigramSimilarity('', 'anything')).toBe(0)
    expect(trigramSimilarity('!!!', 'anything')).toBe(0)
    expect(trigrams('').size).toBe(0)
  })
  it('word-boundary padding keeps word-initial characters weighty (pg_trgm behavior)', () => {
    // 'abc' vs 'abd' share only the '  a' + ' ab' boundary grams
    expect(trigramSimilarity('abc', 'abd')).toBeCloseTo(2 / 6, 5)
  })
})
