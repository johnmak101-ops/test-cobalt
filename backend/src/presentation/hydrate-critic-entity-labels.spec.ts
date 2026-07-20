import { describe, expect, it } from 'vitest'
import type { CriticReview } from '../decisions/critic-review.types'
import {
  entityCodeNameMapsFromRefs,
  hydrateCriticEntityLabels,
  resolveEntityDisplayValue,
} from './hydrate-critic-entity-labels'

const maps = entityCodeNameMapsFromRefs(
  [
    { code: '058', name: 'APL LOGISTICS (CAMBODIA) PTE., LTD' },
    { code: '060', name: 'APL LOGISTICS LTD' },
  ],
  [{ code: 'ASC', name: 'Ascena Retail' }],
  [{ code: 'V01', name: 'Vendor One' }],
)

function sampleCr(over: Partial<CriticReview> = {}): CriticReview {
  return {
    confidence: { score: 0, band: 'low', label: 'low' },
    summary: 's',
    observations: [],
    priorState: { headline: 'h', fields: [] },
    proposedChanges: [],
    riskFlags: [],
    recommendedHumanAction: 'review',
    reasons: [],
    ...over,
  }
}

describe('resolveEntityDisplayValue', () => {
  it('maps forwarder Mesh codes to company names', () => {
    expect(resolveEntityDisplayValue('forwarder_name', '058', maps)).toBe(
      'APL LOGISTICS (CAMBODIA) PTE., LTD',
    )
    expect(resolveEntityDisplayValue('forwarder_name', '060', maps)).toBe('APL LOGISTICS LTD')
  })

  it('is case-insensitive on codes and leaves unknown values alone', () => {
    expect(resolveEntityDisplayValue('forwarder_name', '058', maps)).toContain('APL')
    expect(resolveEntityDisplayValue('forwarder_name', 'UNKNOWN_FWD', maps)).toBe('UNKNOWN_FWD')
    expect(resolveEntityDisplayValue('eta', '2026-08-01', maps)).toBe('2026-08-01')
  })
})

describe('hydrateCriticEntityLabels', () => {
  it('expands forwarder conflict candidates 058/060 to names (the review-table bug)', () => {
    const cr = sampleCr({
      conflicts: [
        {
          field: 'forwarder_name',
          label: 'forwarder name',
          candidates: [
            { value: '058', source: 'Booking Request' },
            { value: '060', source: 'Booking Request' },
          ],
          rationale: 'Emails disagree',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    const vals = out.conflicts![0]!.candidates.map((c) => c.value)
    expect(vals).toEqual([
      'APL LOGISTICS (CAMBODIA) PTE., LTD',
      'APL LOGISTICS LTD',
    ])
  })

  it('hydrates proposedChanges entity fields', () => {
    const cr = sampleCr({
      proposedChanges: [
        {
          field: 'forwarder_name',
          priorValue: null,
          proposedValue: '060',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    const row = out.proposedChanges[0] as { proposedValue: string }
    expect(row.proposedValue).toBe('APL LOGISTICS LTD')
  })

  it('returns null for null input and leaves non-entity conflicts untouched', () => {
    expect(hydrateCriticEntityLabels(null, maps)).toBeNull()
    const cr = sampleCr({
      conflicts: [
        {
          field: 'eta',
          label: 'ETA',
          candidates: [
            { value: '2026-08-01', source: 'System' },
            { value: '2026-08-05', source: 'Email' },
          ],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    expect(out.conflicts![0]!.candidates.map((c) => c.value)).toEqual([
      '2026-08-01',
      '2026-08-05',
    ])
  })
})
