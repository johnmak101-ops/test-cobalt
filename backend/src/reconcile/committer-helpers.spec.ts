import { describe, it, expect } from 'vitest'
import { dedupeCsv, needsHumanReview } from './committer-helpers'

describe('needsHumanReview — a master-data miss is curation, not a shipment review', () => {
  const miss = ['forwarder_name "VENA SAIL (BD) SUPPLY CHAIN CO. LTD." did not exact-match a master']

  it('high band + only master-data misses → NO review (the critic vouched for the extraction)', () => {
    expect(needsHumanReview({ band: 'high', blocking: [], masterMiss: miss })).toBe(false)
  })

  it('low/medium band + master-data miss → review (the name itself may be garbage)', () => {
    expect(needsHumanReview({ band: 'medium', blocking: [], masterMiss: miss })).toBe(true)
    expect(needsHumanReview({ band: 'low', blocking: [], masterMiss: miss })).toBe(true)
  })

  it('no band at all (legacy payload / no critic) → review — never silently confirm on a missing band', () => {
    expect(needsHumanReview({ band: null, blocking: [], masterMiss: miss })).toBe(true)
    expect(needsHumanReview({ band: undefined, blocking: [], masterMiss: miss })).toBe(true)
  })

  it('a blocking hint always reviews, even at high band', () => {
    expect(needsHumanReview({ band: 'high', blocking: ['bare orphan'], masterMiss: [] })).toBe(true)
    expect(needsHumanReview({ band: 'high', blocking: ['bare orphan'], masterMiss: miss })).toBe(true)
  })

  it('nothing to say → no review', () => {
    expect(needsHumanReview({ band: 'high', blocking: [], masterMiss: [] })).toBe(false)
    expect(needsHumanReview({ band: 'low', blocking: [], masterMiss: [] })).toBe(false)
  })
})

describe('dedupeCsv — order-preserving, case-insensitive comma-list dedupe', () => {
  it('drops case-insensitive duplicates, keeping first-seen order + original casing', () => {
    expect(dedupeCsv('A, b, a, B, c')).toBe('A,b,c')
  })
  it('passes a non-list or null through unchanged', () => {
    expect(dedupeCsv('single')).toBe('single')
    expect(dedupeCsv(null)).toBeNull()
  })
})
