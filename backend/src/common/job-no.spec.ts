import { describe, it, expect } from 'vitest'
import { formatJobNo, JOB_NO_PREFIX } from './job-no'

describe('formatJobNo — shared job-number format', () => {
  it('zero-pads the sequence to 4 digits under the shared prefix', () => {
    expect(formatJobNo(7)).toBe('JOB-2026-0007')
    expect(formatJobNo(1234)).toBe('JOB-2026-1234')
  })
  it('starts with JOB_NO_PREFIX (the exact string the sequence query must filter on, so the two never drift)', () => {
    expect(formatJobNo(1).startsWith(JOB_NO_PREFIX)).toBe(true)
  })
})
