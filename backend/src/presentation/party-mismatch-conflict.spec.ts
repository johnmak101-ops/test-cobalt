import { describe, it, expect } from 'vitest'
import { withPartyMismatchConflicts } from './party-mismatch-conflict'
import type { CriticReview } from '../decisions/critic-review.types'

const review = (fields: string[]) =>
  ({
    conflicts: fields.map((field) => ({
      field,
      label: field,
      candidates: [{ value: 'x', source: 'SO' }],
      rationale: 'existing',
    })),
  }) as unknown as CriticReview

const VENDOR = {
  slot: 'vendor' as const,
  raw: 'ELSMCO',
  masterCode: 'SOUOCE',
  masterName: 'SOUTH OCEAN KNITTERS LTD',
}

describe('withPartyMismatchConflicts — a stale master link becomes an answerable question', () => {
  /**
   * Leg 20260405F1: vendor_raw ELSMCO under booking.vendor_id SOUOCE. Order Details flagged it and
   * said "correct in review"; the review desk had no item for it, so nothing the operator could
   * click would reconcile the two.
   */
  it('adds a pickable row naming both companies', () => {
    const out = withPartyMismatchConflicts(null, [VENDOR])
    const row = out?.conflicts?.[0]
    expect(row?.field).toBe('vendor_code')
    expect(row?.label).toBe('Vendor Code')
    // the master is the APPLY option — Current is read from the leg's raw twin.
    // value = the NAME (what the cell prints); master.code is the chip and what a pick posts.
    expect(row?.candidates?.[0]?.value).toBe('SOUTH OCEAN KNITTERS LTD')
    expect(row?.candidates?.[0]?.master).toEqual({
      code: 'SOUOCE',
      name: 'SOUTH OCEAN KNITTERS LTD',
    })
    expect(row?.rationale).toContain('ELSMCO')
    expect(row?.rationale).toContain('SOUOCE')
  })

  it('works on a leg with no critic payload at all', () => {
    expect(withPartyMismatchConflicts(undefined, [VENDOR])?.conflicts).toHaveLength(1)
  })

  it('keeps the existing conflicts and appends', () => {
    const out = withPartyMismatchConflicts(review(['eta']), [VENDOR])
    expect(out?.conflicts?.map((c) => c.field)).toEqual(['eta', 'vendor_code'])
  })

  /** The critic's own row carries the email's candidates — a second row would ask twice, differently. */
  it('does not double up when the critic already contests that party', () => {
    const out = withPartyMismatchConflicts(review(['vendor_code']), [VENDOR])
    expect(out?.conflicts).toHaveLength(1)
    expect(out?.conflicts?.[0]?.rationale).toBe('existing')
  })

  it('falls back to the code when the master has no name', () => {
    const out = withPartyMismatchConflicts(null, [{ ...VENDOR, masterName: '  ' }])
    expect(out?.conflicts?.[0]?.candidates?.[0]?.value).toBe('SOUOCE')
  })

  it('handles both slots', () => {
    const out = withPartyMismatchConflicts(null, [
      VENDOR,
      { slot: 'customer', raw: 'WYSE LONDON', masterCode: 'ELGC', masterName: 'ELEGANT' },
    ])
    expect(out?.conflicts?.map((c) => c.field)).toEqual(['vendor_code', 'customer_code'])
  })

  it('is a no-op when nothing diverges', () => {
    const base = review(['eta'])
    expect(withPartyMismatchConflicts(base, [])).toBe(base)
    expect(withPartyMismatchConflicts(base, [null, undefined])).toBe(base)
  })

  it('ignores a half-formed mismatch', () => {
    const base = review(['eta'])
    expect(withPartyMismatchConflicts(base, [{ ...VENDOR, raw: '  ' }])).toBe(base)
    expect(withPartyMismatchConflicts(base, [{ ...VENDOR, masterCode: '' }])).toBe(base)
  })
})
