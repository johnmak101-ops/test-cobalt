import { describe, it, expect } from 'vitest'
import { queueCriticReview } from './presentation.service'

const STALE_LINK = {
  criticReview: null,
  vendorRaw: 'ELSMCO',
  vendorId: 'v-souoce',
  vendorName: 'SOUTH OCEAN KNITTERS LTD',
  vendorCode: 'SOUOCE',
  vendorNameCh: null,
}

/**
 * The list and the detail page must agree about whether a leg has anything open.
 *
 * The party-mismatch row is computed at read time, not stored — so the detail endpoint saw it and the
 * queue list did not. A leg whose ONLY open question was a stale master link would then be auto-
 * cleared off the desk while its own detail page asked that very question: the two-surfaces bug
 * again, caused by the fix for it.
 */
describe('queueCriticReview — the list sees what the desk will render', () => {
  it('adds the party-mismatch row a queue row would otherwise miss', () => {
    const out = queueCriticReview(STALE_LINK)
    expect(out?.conflicts?.map((c) => c.field)).toEqual(['vendor_code'])
  })

  it('so the leg is NOT auto-cleared off the list', async () => {
    const { autoClearVerdict } = await import('./auto-clear')
    // stored review alone → nothing flagged → the leg would vanish
    expect(autoClearVerdict({}, null, []).clear).toBe(true)
    // with the mismatch row it has a real open question
    expect(autoClearVerdict({ vendorRaw: 'ELSMCO' }, queueCriticReview(STALE_LINK), []).clear).toBe(
      false,
    )
  })

  it('says nothing when the raw twin matches its master', () => {
    expect(queueCriticReview({ ...STALE_LINK, vendorRaw: 'SOUOCE' })).toBeNull()
    // name and nameCh count as a match too, not just the code
    expect(
      queueCriticReview({ ...STALE_LINK, vendorRaw: 'SOUTH OCEAN KNITTERS LTD' }),
    ).toBeNull()
  })

  it('says nothing when there is no master linked at all', () => {
    expect(queueCriticReview({ ...STALE_LINK, vendorId: null })).toBeNull()
  })

  it('covers the customer slot the same way', () => {
    const out = queueCriticReview({
      criticReview: null,
      customerRaw: 'WYSE LONDON',
      customerId: 'c-elgc',
      customerName: 'ELEGANT',
      customerCode: 'ELGC',
      customerNameCh: null,
    })
    expect(out?.conflicts?.map((c) => c.field)).toEqual(['customer_code'])
  })

  it('keeps the stored conflicts when there is no mismatch', () => {
    const stored = {
      conflicts: [
        { field: 'eta', label: 'eta', candidates: [{ value: 'x', source: 'SO' }], rationale: 'y' },
      ],
    }
    const out = queueCriticReview({ criticReview: stored, vendorRaw: 'SOUOCE', ...{} })
    expect(out?.conflicts?.map((c) => c.field)).toEqual(['eta'])
  })
})
