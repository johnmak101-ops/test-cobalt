import { describe, it, expect } from 'vitest'
import { dedupeCsv } from './committer-helpers'

describe('dedupeCsv — order-preserving, case-insensitive comma-list dedupe', () => {
  it('drops case-insensitive duplicates, keeping first-seen order + original casing', () => {
    expect(dedupeCsv('A, b, a, B, c')).toBe('A,b,c')
  })
  it('passes a non-list or null through unchanged', () => {
    expect(dedupeCsv('single')).toBe('single')
    expect(dedupeCsv(null)).toBeNull()
  })
})
