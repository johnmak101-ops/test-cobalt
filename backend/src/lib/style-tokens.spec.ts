import { describe, it, expect } from 'vitest'
import {
  isStyleCodeToken,
  isWeakStyleLabel,
  preferStyleCodeCandidates,
} from './style-tokens'

describe('style-code vs weak label (packing list preference)', () => {
  it('recognizes packing style codes', () => {
    expect(isStyleCodeToken('C198')).toBe(true)
    expect(isStyleCodeToken('C200')).toBe(true)
    expect(isStyleCodeToken('PUH26BHALE')).toBe(true)
    expect(isStyleCodeToken('56571/SS26SW022')).toBe(true)
  })

  it('rejects colorway and CJK product names', () => {
    expect(isStyleCodeToken('RED STRIPE')).toBe(false)
    expect(isStyleCodeToken('NAVY')).toBe(false)
    expect(isStyleCodeToken('女装针织长袖套头衫')).toBe(false)
    expect(isWeakStyleLabel('RED STRIPE')).toBe(true)
    expect(isWeakStyleLabel('女装针织长袖套头衫, 女装针织短袖开襟衫')).toBe(true)
    expect(isWeakStyleLabel('C198')).toBe(false)
  })

  it('preferStyleCodeCandidates drops weak when codes present', () => {
    expect(preferStyleCodeCandidates(['RED STRIPE', 'C198', 'C198'])).toEqual(['C198', 'C198'])
    expect(preferStyleCodeCandidates(['RED STRIPE', 'NAVY'])).toEqual(['RED STRIPE', 'NAVY'])
  })
})
