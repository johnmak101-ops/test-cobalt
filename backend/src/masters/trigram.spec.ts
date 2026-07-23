import { describe, it, expect } from 'vitest'
import { trigrams, trigramSimilarity, tokenMatch, tokenSubset } from './trigram'

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

describe('CJK folding + character bigrams (Chinese-name retrieval, 0022)', () => {
  it('simplified vs traditional of the SAME company scores 1 (the DGJAFA case)', () => {
    expect(trigramSimilarity('东莞市嘉发服饰有限公司', '東莞市嘉發服飾有限公司')).toBe(1)
  })
  it('a partial Chinese core still clears the 0.3 threshold', () => {
    expect(trigramSimilarity('嘉发服饰', '東莞市嘉發服飾有限公司')).toBeGreaterThan(0.3)
  })
  it('unrelated Chinese names stay below threshold', () => {
    expect(trigramSimilarity('吉安宏伟针织服装有限公司', '東莞市嘉發服飾有限公司')).toBeLessThan(0.3)
  })
  it('Latin behavior is unchanged by the fold (no-op on non-Han input)', () => {
    expect(trigramSimilarity('MACAU FUNG TAI', 'macau fung tai')).toBe(1)
  })
  it('tokenMatch bridges scripts (simplified query, traditional master alias)', () => {
    expect(tokenMatch('东莞市嘉发服饰有限公司', '東莞市嘉發服飾有限公司')).toBe(true)
  })
})

describe('tokenMatch (name:tokens recall signal)', () => {
  it('short master name inside a long raw (the DSV case)', () => {
    expect(tokenMatch('DSV AIR AND SEA CO LTD', 'DSV')).toBe(true)
  })
  it('legal-form stopwords are ignored', () => {
    expect(tokenMatch('MAERSK LOGISTICS COMPANY LIMITED', 'MAERSK LOGISTICS')).toBe(true)
  })
  it('does not fire on disjoint names or stopword-only overlap', () => {
    expect(tokenMatch('KUEHNE NAGEL LTD', 'DSV')).toBe(false)
    expect(tokenMatch('GLOBAL CO LTD', 'PACIFIC COMPANY LIMITED')).toBe(false)
  })
  it('CJK names tokenize (公司 dropped as a stopword)', () => {
    expect(tokenMatch('广州保迅诺物流有限公司', '广州保迅诺物流')).toBe(true)
  })
})

describe('tokenSubset (reverse direction: input tokens ⊆ master tokens)', () => {
  it('a bare city name is contained in the airport long name (the SHANGHAI→CNPVG live-probe gap)', () => {
    expect(tokenSubset('SHANGHAI', 'Shanghai Pudong International Airport')).toBe(true)
  })
  it('does not fire on disjoint or stopword-only input', () => {
    expect(tokenSubset('SHANGHAI', 'KUEHNE NAGEL LTD')).toBe(false)
    expect(tokenSubset('CO LTD', 'Shanghai Pudong International Airport')).toBe(false)
  })
  it('is strictly the REVERSE of tokenMatch subset — long input over a short master does not fire', () => {
    expect(tokenSubset('DSV AIR AND SEA CO LTD', 'DSV')).toBe(false)
  })
})
