import { describe, it, expect } from 'vitest'
import {
  reviewQueueApiView,
  isStaleConflict,
  REVIEW_INVALIDATED_KEYS,
  type ReviewQueueView,
} from './use-review-queue'

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

/**
 * A verdict writes leg fields, and the backend records each as a `review` history row. Without
 * shipment-history on this list the leg refetched with the new value while its Change History
 * popover kept the pre-decision copy — leg 2026016716 showed Consignee Name JI'AN HONGWEI … over a
 * timeline whose newest entry still set WYSE LONDON.
 */
describe('REVIEW_INVALIDATED_KEYS', () => {
  it('refreshes the history a verdict writes to, not just the value it changes', () => {
    const keys = REVIEW_INVALIDATED_KEYS.map((k) => k.join('.'))
    expect(keys).toContain('shipment')
    expect(keys).toContain('shipment-history')
  })

  it('keys stay unscoped, so a link covers BOTH legs by prefix', () => {
    for (const key of REVIEW_INVALIDATED_KEYS) {
      expect(key).toHaveLength(1)
    }
  })
})
