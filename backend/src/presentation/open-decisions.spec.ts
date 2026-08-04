import { describe, it, expect } from 'vitest'
import { openDecisions, sameStoredValue } from './open-decisions'
import type { CriticReview } from '../decisions/critic-review.types'

const conflict = (field: string, system: string, ...offered: string[]) => ({
  field,
  label: field,
  candidates: [
    { value: system, source: 'System' },
    ...offered.map((value) => ({ value, source: 'Draft B/L' })),
  ],
  rationale: 'x',
})

const review = (...conflicts: ReturnType<typeof conflict>[]) =>
  ({ conflicts } as unknown as CriticReview)

/** Leg A84B3B1A / SO S13784413 — the busiest card in the dev queue, and every proposal already stored. */
const REAL_LEG = {
  consigneeAddress: 'PRIMARK LTD, 22-24, PARNELL STREET, ARTHUR RYAN HOUSE, , Dublin Ireland',
  vesselName: 'MARIBO MAERSK',
  voyageNo: '631W',
  qty: 784,
}

describe('sameStoredValue', () => {
  it('text ignores case and whitespace shape', () => {
    expect(sameStoredValue('vesselName', 'maribo   maersk', 'MARIBO MAERSK')).toBe(true)
    expect(sameStoredValue('vesselName', 'MARIBO MAERSK', 'MAASTRICHT MAERSK')).toBe(false)
  })

  it('dates compare by day — the leg stores an instant, the email stated a date', () => {
    expect(sameStoredValue('etd', '2026-08-10', new Date('2026-08-10T00:00:00Z'))).toBe(true)
    expect(sameStoredValue('etd', '2026-08-10', new Date('2026-08-11T00:00:00Z'))).toBe(false)
  })

  it('numbers compare numerically', () => {
    expect(sameStoredValue('qty', '784', 784)).toBe(true)
    expect(sameStoredValue('qty', '1,240', 1240)).toBe(true)
    expect(sameStoredValue('qty', '369', 784)).toBe(false)
  })
})

describe('openDecisions — the advice minus what the commit settled', () => {
  it('settles the real leg: every proposal is already stored', () => {
    const r = openDecisions(
      REAL_LEG,
      review(
        conflict('vessel_name', 'MAASTRICHT MAERSK', 'MARIBO MAERSK'),
        conflict('voyage_no', '630W', '631W'),
        conflict('qty', '369', '784'),
        conflict('consignee_address', 'PRIMARK STORES (USD A/C), 41 WEST STREET HOUSE', REAL_LEG.consigneeAddress),
      ),
      {},
    )
    expect(r.settledFields).toEqual(['vessel_name', 'voyage_no', 'qty', 'consignee_address'])
    // Nothing left for a human: the summary line on the dashboard must not claim four fields disagree.
    expect(r.openFields).toEqual([])
  })

  it('openFields is what the table will show — the unsettled conflicts', () => {
    const r = openDecisions(
      REAL_LEG,
      review(
        conflict('vessel_name', 'MARIBO MAERSK', 'EVER GIVEN'),
        conflict('voyage_no', '630W', '631W'),
        conflict('etd', '', '2026-08-10'),
      ),
      {},
    )
    expect(r.openFields).toEqual(['vessel_name', 'etd'])
  })

  it('drops fields the desk renders no row for — a summary must not promise one', () => {
    const r = openDecisions(
      REAL_LEG,
      review(
        conflict('gross_weight', '100', '8667.68'),
        conflict('measurement', '1', '2'),
        conflict('hts_code', 'a', 'b'),
        conflict('item_style_no', 'a', 'b'),
        conflict('etd', '', '2026-08-10'),
      ),
      {},
    )
    expect(r.openFields).toEqual(['etd'])
  })

  it('a genuine disagreement stays open', () => {
    const r = openDecisions(REAL_LEG, review(conflict('vessel_name', 'MARIBO MAERSK', 'EVER GIVEN')), {})
    expect(r.settledFields).toEqual([])
  })

  /** One candidate agreeing while another disagrees is still "which of these?". */
  it('does NOT settle when the candidates disagree with each other', () => {
    const r = openDecisions(
      REAL_LEG,
      review(conflict('vessel_name', 'OLD', 'MARIBO MAERSK', 'EVER GIVEN')),
      {},
    )
    expect(r.settledFields).toEqual([])
  })

  it('a resolved party matches by master CODE as well as by name', () => {
    const c = {
      field: 'vendor_code',
      label: 'Vendor',
      candidates: [
        { value: '', source: 'system' },
        { value: 'FENIX FASHION LIMITED', source: 'SO', master: { code: 'FEFALT' } },
      ],
      rationale: 'x',
    }
    expect(openDecisions({ vendorRaw: 'FEFALT' }, review(c as never), {}).settledFields).toEqual(['vendor_code'])
    expect(openDecisions({ vendorRaw: 'FENIX FASHION LIMITED' }, review(c as never), {}).settledFields).toEqual(['vendor_code'])
    expect(openDecisions({ vendorRaw: 'SOMEONE ELSE' }, review(c as never), {}).settledFields).toEqual([])
  })

  it('nothing offered, no live value, or an unmapped field → never settled', () => {
    expect(openDecisions(REAL_LEG, review(conflict('vessel_name', 'MARIBO MAERSK')), {}).settledFields).toEqual([])
    expect(openDecisions({}, review(conflict('vessel_name', 'OLD', 'MARIBO MAERSK')), {}).settledFields).toEqual([])
    expect(openDecisions(REAL_LEG, review(conflict('some_unmapped', 'a', 'b')), {}).settledFields).toEqual([])
  })

  it('reports the party slots that carry a master', () => {
    const r = openDecisions({}, review(), { customer: 'WHISTLES LIMITED', forwarder: null, vendor: '  ' })
    expect(r.resolvedParties).toEqual([{ slot: 'customer', name: 'WHISTLES LIMITED' }])
  })
})
