import { describe, expect, it } from 'vitest'
import { isShadowEligible } from './shadow-lane'

describe('isShadowEligible', () => {
  it('true only when the queue marked wouldBeAuto', () => {
    expect(isShadowEligible({ wouldBeAuto: true })).toBe(true)
    expect(isShadowEligible({})).toBe(false)
    expect(isShadowEligible(undefined)).toBe(false)
  })
})
