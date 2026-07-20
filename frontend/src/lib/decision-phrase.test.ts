import { describe, expect, it } from 'vitest'
import { decisionPhrase } from './decision-phrase'

describe('decisionPhrase priority', () => {
  it('which-shipment beats everything', () => {
    expect(decisionPhrase({ candidates: 2, conflictField: 'ETD', gateCodes: ['g-total'] })).toBe(
      'Pick the right shipment (2 candidates) · 揀邊票貨',
    )
  })
  it('order: real → blanks → conflict → gate → ai-low', () => {
    expect(decisionPhrase({ weakIdentity: true })).toBe(
      'Confirm this is a real shipment · 真貨定通知',
    )
    expect(decisionPhrase({ criticalBlanks: 2 })).toBe('Fill 2 critical blanks · 補關鍵欄位')
    expect(decisionPhrase({ conflictField: 'ETD' })).toBe('Resolve ETD conflict · 解欄位衝突')
    expect(decisionPhrase({ gateCodes: ['g-checksum'] })).toBe(
      'Verify container check digit · 驗證 gate',
    )
    expect(decisionPhrase({ aiLowReason: true })).toBe(
      'Verify extraction (AI low confidence) · 驗證拆解',
    )
  })
  it('nothing decision-shaped → null', () => {
    expect(decisionPhrase({})).toBeNull()
  })
})
