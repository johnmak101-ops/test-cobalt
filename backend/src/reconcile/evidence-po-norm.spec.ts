import { describe, it, expect } from 'vitest'
import { evidencePoNorm } from './evidence-po-norm'

describe('evidencePoNorm (parity with po-enrichment poKeyOf)', () => {
  it('prefers po_no over match_keys.customer_po', () => {
    expect(evidencePoNorm('PO-A', { customer_po: 'PO-B' })).toBe('POA')
  })

  it('falls back to customer_po when po_no is empty', () => {
    expect(evidencePoNorm(null, { customer_po: 'FEL-GZ-OSA-2842' })).toBe('FELGZOSA2842')
    expect(evidencePoNorm('', { customer_po: 'po 1' })).toBe('PO1')
  })

  it('returns null when neither side yields a key', () => {
    expect(evidencePoNorm(null, { so_no: 'SO-ONLY' })).toBeNull()
    expect(evidencePoNorm(null, null)).toBeNull()
  })
})
