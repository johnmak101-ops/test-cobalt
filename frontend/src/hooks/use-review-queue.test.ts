import { describe, it, expect } from 'vitest'
import { reviewQueueApiView, isStaleConflict, type ReviewQueueView } from './use-review-queue'

describe('reviewQueueApiView', () => {
  it('maps UI tabs to backend view query params', () => {
    const cases: [ReviewQueueView, string][] = [
      ['active', 'pending'],
      ['rejected', 'dismissed'],
      ['approved', 'approved'],
    ]
    for (const [ui, api] of cases) {
      expect(reviewQueueApiView(ui)).toBe(api)
    }
  })
})

describe('isStaleConflict', () => {
  it('detects API 409 / modified messages', () => {
    expect(isStaleConflict(new Error('API error 409: shipment was modified; reload and try again'))).toBe(true)
    expect(isStaleConflict(new Error('shipment was modified; reload and try again'))).toBe(true)
    expect(isStaleConflict(new Error('API error 500: boom'))).toBe(false)
    expect(isStaleConflict(null)).toBe(false)
  })
})
