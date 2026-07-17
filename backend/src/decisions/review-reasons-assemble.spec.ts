import { describe, it, expect } from 'vitest'
import { assembleIngestReviewReasons } from './review-reasons-assemble'
import type { CreateDecisionDto } from './dto'
import type { DispositionResult } from './email-disposition'

const dto = (over: Partial<CreateDecisionDto> = {}): CreateDecisionDto =>
  ({
    matchKey: {},
    fields: {},
    pos: [],
    confidence: 50,
    ...over,
  }) as CreateDecisionDto

describe('assembleIngestReviewReasons (#166)', () => {
  it('does not double-append when disposition=review reuses dto.reviewReasons', () => {
    const reasons = [
      'matched multiple backend legs (ambiguous) — email identity is not unique; multi-leg DB may be valid',
      'a PO on this email currently belongs to a different shipment — moving/splitting a PO needs review',
    ]
    const d = dto({ disposition: 'review', reviewReasons: reasons })
    const disp: DispositionResult = { disposition: 'review', reasons } // email-disposition path
    const out = assembleIngestReviewReasons(d, disp)
    expect(out).toEqual(reasons)
    expect(out).toHaveLength(2)
  })

  it('still adds lookup-context reasons not already on the agent payload', () => {
    const d = dto({
      disposition: 'auto',
      reviewReasons: ['matched multiple backend legs (ambiguous)'],
    })
    const disp: DispositionResult = {
      disposition: 'review',
      reasons: ['the customer is new or not recognized'],
    }
    const out = assembleIngestReviewReasons(d, disp)
    expect(out).toContain('matched multiple backend legs (ambiguous)')
    expect(out).toContain('the customer is new or not recognized')
    expect(out).toHaveLength(2)
  })

  it('merges opsNotes without duplicating', () => {
    const d = dto({
      reviewReasons: ['r1'],
      opsNotes: ['Cannot match "X" in the forwarder list'],
    })
    const disp: DispositionResult = { disposition: 'auto', reasons: [] }
    const out = assembleIngestReviewReasons(d, disp)
    expect(out).toEqual(['r1', 'Cannot match "X" in the forwarder list'])
  })
})
