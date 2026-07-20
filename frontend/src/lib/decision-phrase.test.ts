import { describe, expect, it } from 'vitest'
import { decisionPhrase } from './decision-phrase'

describe('decisionPhrase priority', () => {
  it('which-shipment beats everything', () => {
    expect(decisionPhrase({ candidates: 2, conflictField: 'ETD', gateCodes: ['g-total'] })).toBe(
      'Pick the right shipment (2 candidates)',
    )
  })
  it('order: real → blanks → conflict → gate → ai-low', () => {
    expect(decisionPhrase({ weakIdentity: true })).toBe('Confirm this is a real shipment')
    expect(decisionPhrase({ criticalBlanks: 2 })).toBe('Fill 2 critical blanks')
    expect(decisionPhrase({ conflictField: 'ETD' })).toBe('Resolve ETD conflict')
    expect(decisionPhrase({ gateCodes: ['g-checksum'] })).toBe('Verify container check digit')
    expect(decisionPhrase({ aiLowReason: true })).toBe('Verify extraction (AI low confidence)')
  })
  it('nothing decision-shaped → null', () => {
    expect(decisionPhrase({})).toBeNull()
  })
  it('English only — no Traditional Chinese in phrases', () => {
    const samples = [
      decisionPhrase({ candidates: 2 }),
      decisionPhrase({ weakIdentity: true }),
      decisionPhrase({ criticalBlanks: 1 }),
      decisionPhrase({ conflictField: 'ETD' }),
      decisionPhrase({ gateCodes: ['g-total'] }),
      decisionPhrase({ aiLowReason: true }),
    ]
    for (const s of samples) {
      expect(s).toBeTruthy()
      expect(s).not.toMatch(/[\u4e00-\u9fff]/)
    }
  })
})
