import { describe, it, expect } from 'vitest'
import { buildNeedsAttention, NEEDS_ATTENTION_MAX } from './needs-attention'

describe('buildNeedsAttention', () => {
  it('suppresses conflict flags and gate counts when conflict table is present', () => {
    const items = buildNeedsAttention({
      conflictsCount: 2,
      riskFlags: [
        {
          code: 'INTRA_EMAIL_FIELD_CONFLICT',
          severity: 'high',
          message: '3 field conflicts — values disagree (see conflict table).',
        },
        {
          code: 'AMBIGUOUS_MATCH',
          severity: 'high',
          message: 'Matched more than one existing leg.',
        },
      ],
      reviewReasons: ['3 field conflict(s)', 'backend conflict on qty, gross_weight'],
    })
    expect(items.every((i) => !/3 field conflict/i.test(i.text))).toBe(true)
    expect(items.some((i) => /leg/i.test(i.text))).toBe(true)
  })

  it('keeps multi_id + master_miss under cap', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'AMBIGUOUS_MATCH',
          severity: 'high',
          message: 'Matched more than one existing leg.',
        },
      ],
      reviewReasons: [
        'pol "CHINADONG" did not exact/curated-match a port master — left unlinked',
        'no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment',
      ],
    })
    expect(items.length).toBeLessThanOrEqual(NEEDS_ATTENTION_MAX)
    expect(items.some((i) => /leg|job|match/i.test(i.text))).toBe(true)
    expect(items.some((i) => /port|POL|master/i.test(i.text))).toBe(true)
  })

  it('returns empty when only conflict-class content and table present', () => {
    const items = buildNeedsAttention({
      conflictsCount: 1,
      riskFlags: [
        {
          code: 'BACKEND_CONFLICT',
          severity: 'high',
          message: 'Email disagrees on Qty.',
        },
      ],
      reviewReasons: ['3 field conflict(s)'],
    })
    expect(items).toEqual([])
  })

  it('shows conflict flag when no table (heads-up only)', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        {
          code: 'INTRA_EMAIL_FIELD_CONFLICT',
          severity: 'high',
          message: '3 field conflicts — values disagree.',
        },
      ],
      reviewReasons: ['3 field conflict(s)'],
    })
    expect(items).toHaveLength(1)
    expect(items[0]!.text).toMatch(/values disagree/)
  })

  it('prefers high severity within cap of 2', () => {
    const items = buildNeedsAttention({
      conflictsCount: 0,
      riskFlags: [
        { code: 'SCAN_OCR_RISK', severity: 'low', message: 'OCR weak' },
        { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'Multi job' },
        { code: 'PARTY_UNRESOLVED', severity: 'medium', message: 'Party miss' },
      ],
      reviewReasons: [],
    })
    expect(items).toHaveLength(2)
    expect(items[0]!.severity).toBe('high')
  })
})
