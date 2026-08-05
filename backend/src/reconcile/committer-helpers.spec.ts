import { describe, it, expect } from 'vitest'
import { dedupeCsv, needsHumanReview, serializeJourney, JOURNEY_MAX_CHARS, type JourneyLeg } from './committer-helpers'

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

describe('serializeJourney — a chain that does not fit stores null, never a shorter chain', () => {
  const leg = (seq: number): JourneyLeg => ({ seq, mode: 'Air', pol: 'PVG', pod: 'DEL', doc: null })

  it('round-trips a real 2-leg chain (the shape actually in prod, 117 chars)', () => {
    const chain: JourneyLeg[] = [
      { seq: 1, mode: 'Air', pol: 'PVG', pod: 'DEL', doc: null },
      { seq: 2, mode: 'Air', pol: 'DEL', pod: 'LHR', doc: null },
    ]
    const out = serializeJourney(chain)
    expect(out).toBe(JSON.stringify(chain))
    expect(out!.length).toBe(117)
    expect(JSON.parse(out!)).toEqual(chain) // the point: readers can parse it
  })

  it('returns null for an empty or absent chain', () => {
    expect(serializeJourney([])).toBeNull()
    expect(serializeJourney(null)).toBeNull()
    expect(serializeJourney(undefined)).toBeNull()
  })

  it('whatever it returns is always parseable — the old .slice(0,2000) was not', () => {
    const huge = Array.from({ length: 200 }, (_, i) => leg(i + 1))
    const sliced = JSON.stringify(huge).slice(0, JOURNEY_MAX_CHARS) // what this used to store
    expect(() => JSON.parse(sliced)).toThrow() // ← the defect, pinned as a defect
    expect(serializeJourney(huge)).toBeNull() // ← and what we do instead
  })

  it('drops the whole chain rather than a suffix — a short chain is a WRONG route, not a partial one', () => {
    const long = Array.from({ length: 200 }, (_, i) => leg(i + 1))
    const out = serializeJourney(long)
    expect(out).toBeNull()
    // specifically NOT this: a parseable prefix that renders as a confident, complete, wrong journey
    expect(out).not.toBe(JSON.stringify(long.slice(0, 2)))
  })

  it('accepts a chain sitting just under the cap and refuses the one just over it', () => {
    // grow leg-by-leg to find the exact boundary rather than assuming a leg count
    let fits = 0
    for (let n = 1; n <= 200; n++) {
      const c = Array.from({ length: n }, (_, i) => leg(i + 1))
      if (JSON.stringify(c).length <= JOURNEY_MAX_CHARS) fits = n
      else break
    }
    expect(fits).toBeGreaterThan(20) // ~29 hops of headroom; no real journey is near this
    expect(serializeJourney(Array.from({ length: fits }, (_, i) => leg(i + 1)))).not.toBeNull()
    expect(serializeJourney(Array.from({ length: fits + 1 }, (_, i) => leg(i + 1)))).toBeNull()
  })

  it('counts UTF-16 units, so a chain padded with astral chars is measured as the column measures it', () => {
    // 𠀀 is a surrogate pair: length 2 in JS, 2 nvarchar units. The cap must not be fooled either way.
    const wide: JourneyLeg[] = [{ seq: 1, mode: 'Sea', pol: 'PVG', pod: 'DEL', doc: '𠀀'.repeat(1200) }]
    expect(JSON.stringify(wide).length).toBeGreaterThan(JOURNEY_MAX_CHARS)
    expect(serializeJourney(wide)).toBeNull()
  })
})
