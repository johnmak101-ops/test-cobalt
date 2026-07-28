import { describe, it, expect } from 'vitest'
import { primaryReason } from './ReviewQueuePanel'

/**
 * The review row's answer to an alert's `message`. Without it the card shows an identifier and
 * nothing else, and the operator has to open the leg to find out why it is on the desk at all —
 * which is the difference the dashboard exists to save them.
 */
describe('primaryReason', () => {
  it('humanizes the first operator-facing reason', () => {
    const out = primaryReason(['matched multiple backend legs (ambiguous)'])
    expect(out).toBeTruthy()
    // Humanized, not the raw pipeline string.
    expect(out).not.toBe('matched multiple backend legs (ambiguous)')
  })

  /** Ops-internal chatter exists for the pipeline's own audit trail. Leading a card with one tells
   *  the operator nothing about what to do, so it must never win the single line on offer. */
  it('skips silent ops lines in favour of a real reason', () => {
    const out = primaryReason([
      "auto: subject-party-pin: vendor_code kept 'ROKNFT' over 'SOUOCE'",
      'matched multiple backend legs (ambiguous)',
    ])
    expect(out).toBeTruthy()
    expect(out).not.toMatch(/subject-party-pin/i)
  })

  it('returns null when there is nothing worth showing — the caller has a fallback', () => {
    expect(primaryReason([])).toBeNull()
    expect(primaryReason(undefined)).toBeNull()
    expect(primaryReason(['   '])).toBeNull()
    expect(primaryReason(["auto: subject-party-pin: vendor_code kept 'X' over 'Y'"])).toBeNull()
  })
})
