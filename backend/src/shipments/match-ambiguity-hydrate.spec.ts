import { describe, it, expect } from 'vitest'
import {
  needsMatchAmbiguityHydration,
  buildMatchAmbiguityFromCandidates,
  dedupeReviewReasons,
  stripStaleAmbiguousSignals,
  lookupQueryFromLeg,
  withMatchAmbiguity,
} from './match-ambiguity-hydrate'
import type { CriticReview } from '../decisions/critic-review.types'

const cr = (over: Partial<CriticReview> = {}): CriticReview => ({
  confidence: { score: 40, band: 'low', label: 'Low' },
  summary: 's',
  observations: [],
  priorState: { headline: 'h', fields: [] },
  proposedChanges: [],
  riskFlags: [{ code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'multi' }],
  recommendedHumanAction: 'review',
  reasons: [],
  ...over,
})

describe('needsMatchAmbiguityHydration', () => {
  it('true when flag and no candidates', () => {
    expect(needsMatchAmbiguityHydration(cr(), [])).toBe(true)
  })
  it('true when reason text only', () => {
    expect(
      needsMatchAmbiguityHydration(null, ['matched multiple backend legs (ambiguous)']),
    ).toBe(true)
  })
  it('false when matchAmbiguity already has ≥2', () => {
    expect(
      needsMatchAmbiguityHydration(
        cr({
          matchAmbiguity: {
            candidates: [
              { shipmentId: 'a' },
              { shipmentId: 'b' },
            ],
          },
        }),
        [],
      ),
    ).toBe(false)
  })
})

describe('buildMatchAmbiguityFromCandidates', () => {
  it('builds two cards from lookup wire shape', () => {
    const ma = buildMatchAmbiguityFromCandidates(
      { so_no: 'SO1' },
      [
        { id: 'id-a', jobNo: 'J1', soNo: 'SO1', matchedBy: 'strong_key', pos: ['P1'] },
        { id: 'id-b', jobNo: 'J2', soNo: 'SO1', matchedBy: 'strong_key' },
      ],
    )
    expect(ma?.candidates).toHaveLength(2)
    expect(ma?.emailKey?.so_no).toBe('SO1')
    expect(ma?.candidates.map((c) => c.jobNo).sort()).toEqual(['J1', 'J2'])
  })

  it('T4 shared container banner', () => {
    const ma = buildMatchAmbiguityFromCandidates(
      { container_no: 'CTR1' },
      [
        { id: 'a', bookingNo: 'BK1', containerNo: 'CTR1', matchedBy: 'strong_key' },
        { id: 'b', bookingNo: 'BK2', containerNo: 'CTR1', matchedBy: 'strong_key' },
      ],
    )
    expect(ma?.sharedContainer).toMatch(/CTR1/i)
  })

  it('null when only one valid id', () => {
    expect(
      buildMatchAmbiguityFromCandidates({ so_no: 'X' }, [{ id: 'only', soNo: 'X' }]),
    ).toBeNull()
  })
})

describe('dedupeReviewReasons + stripStale', () => {
  it('dedupes exact duplicates', () => {
    expect(
      dedupeReviewReasons([
        'matched multiple backend legs (ambiguous)',
        'matched multiple backend legs (ambiguous)',
        '3 field conflict(s)',
      ]),
    ).toEqual(['matched multiple backend legs (ambiguous)', '3 field conflict(s)'])
  })

  it('strip removes multi reason and AMBIGUOUS_MATCH flag', () => {
    const out = stripStaleAmbiguousSignals(cr(), [
      'matched multiple backend legs (ambiguous)',
      '3 field conflict(s)',
    ])
    expect(out.reviewReasons).toEqual(['3 field conflict(s)'])
    expect(out.criticReview?.riskFlags.some((f) => f.code === 'AMBIGUOUS_MATCH')).toBe(false)
    expect(out.criticReview?.matchAmbiguity).toBeUndefined()
  })
})

describe('lookupQueryFromLeg', () => {
  it('prefers matchKeys then columns + first PO', () => {
    const q = lookupQueryFromLeg({
      bookingNo: 'BK1',
      soNo: null,
      matchKeys: { so_no: 'SOX' },
      pos: ['PO1', 'PO2'],
    })
    expect(q.so_no).toBe('SOX')
    expect(q.booking_no).toBe('BK1')
    expect(q.customer_po).toBe('PO1')
  })
})

describe('withMatchAmbiguity', () => {
  it('adds AMBIGUOUS_MATCH flag if missing', () => {
    const out = withMatchAmbiguity(cr({ riskFlags: [] }), {
      kind: 'multi_candidate',
      candidates: [{ shipmentId: 'a' }, { shipmentId: 'b' }],
      candidateCount: 2,
    })
    expect(out.riskFlags.some((f) => f.code === 'AMBIGUOUS_MATCH')).toBe(true)
    expect(out.matchAmbiguity?.candidates).toHaveLength(2)
  })
})
