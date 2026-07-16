import { describe, it, expect } from 'vitest'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { CreateDecisionDto } from './dto'

const base = {
  matchKey: { so_no: 'SO-1' },
  fields: { so_no: 'SO-1' },
  confidence: 80,
}

const errs = (o: unknown) => validateSync(plainToInstance(CreateDecisionDto, o))

describe('CreateDecisionDto — criticReview', () => {
  it('accepts optional criticReview as a plain object', () => {
    const e = errs({
      ...base,
      criticReview: {
        confidence: { score: 38, band: 'low', label: 'Low' },
        summary: 'Two HBLs',
        observations: [],
        priorState: { headline: 'New', fields: [] },
        proposedChanges: [],
        riskFlags: [],
        recommendedHumanAction: 'split_or_multi_leg',
        reasons: ['multi'],
      },
    })
    expect(e).toHaveLength(0)
  })

  it('allows omitting criticReview (legacy callers)', () => {
    expect(errs(base)).toHaveLength(0)
  })

  it('rejects non-object criticReview', () => {
    const e = errs({ ...base, criticReview: 'not-an-object' })
    expect(e.some((x) => x.property === 'criticReview')).toBe(true)
  })

  it('accepts optional matchAmbiguity object (#129)', () => {
    const e = errs({
      ...base,
      matchAmbiguity: {
        kind: 'multi_candidate',
        candidates: [{ shipmentId: 's1', jobNo: 'J1' }],
        candidateCount: 1,
      },
    })
    expect(e).toHaveLength(0)
  })
})
