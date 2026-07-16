import { describe, it, expect } from 'vitest'
import { buildAmbiguityPickEvent } from './ambiguity-pick-log'
import type { CriticReview } from '../decisions/critic-review.types'

const cr = (over: Partial<CriticReview> = {}): CriticReview => ({
  confidence: { score: 40, band: 'low', label: 'Low' },
  summary: 's',
  observations: [],
  priorState: { headline: 'h', fields: [] },
  proposedChanges: [],
  riskFlags: [],
  recommendedHumanAction: 'review',
  reasons: [],
  matchAmbiguity: {
    kind: 'multi_candidate',
    emailKey: { so_no: 'SO1' },
    candidates: [
      { shipmentId: 'a', jobNo: 'JA' },
      { shipmentId: 'b', jobNo: 'JB' },
    ],
    candidateCount: 2,
    suggestion: {
      shipmentId: 'b',
      score: 0.9,
      rationale: 'x',
      cannotDecide: false,
      source: 'llm_rank',
    },
  },
  ...over,
})

describe('buildAmbiguityPickEvent', () => {
  it('null without multi candidates', () => {
    expect(
      buildAmbiguityPickEvent({
        sourceShipmentId: 's',
        humanChoiceShipmentId: 't',
        actorId: 'u',
        criticReview: null,
      }),
    ).toBeNull()
  })

  it('records agree when human picks suggestion', () => {
    const e = buildAmbiguityPickEvent({
      sourceShipmentId: 's',
      humanChoiceShipmentId: 'b',
      actorId: 'u1',
      criticReview: cr(),
    })
    expect(e?.agreedWithSuggestion).toBe(true)
    expect(e?.suggestionSource).toBe('llm_rank')
    expect(e?.candidateIds).toEqual(['a', 'b'])
  })

  it('records disagree when human picks other', () => {
    const e = buildAmbiguityPickEvent({
      sourceShipmentId: 's',
      humanChoiceShipmentId: 'a',
      actorId: 'u1',
      criticReview: cr(),
    })
    expect(e?.agreedWithSuggestion).toBe(false)
  })
})
