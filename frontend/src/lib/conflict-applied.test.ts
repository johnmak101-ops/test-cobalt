import { describe, it, expect } from 'vitest'
import {
  isAppliedToLeg,
  liveValueForField,
  partitionAppliedConflicts,
  sameStoredValue,
} from './conflict-applied'
import type { CriticConflict } from './critic-review'

function conflict(field: string, system: string, ...offered: string[]): CriticConflict {
  return {
    field,
    label: field,
    candidates: [
      { value: system, source: 'System' },
      ...offered.map((value) => ({ value, source: 'Draft B/L' })),
    ],
    rationale: 'x',
  } as CriticConflict
}

/**
 * The real leg the desk showed as "3 fields disagree" while storing every proposed value already —
 * A84B3B1A / SO S13784413, the busiest card in the dev queue.
 */
const REAL_LEG = {
  consigneeAddress: 'PRIMARK LTD, 22-24, PARNELL STREET, ARTHUR RYAN HOUSE, , Dublin Ireland',
  vesselName: 'MARIBO MAERSK',
  voyageNumber: '631W',
  quantityShipped: 784,
}

describe('liveValueForField — the DTO does not name columns the way the critic does', () => {
  it('reads through the explicit mapping, not leg[column]', () => {
    expect(liveValueForField(conflict('voyage_no', '630W', '631W'), REAL_LEG)).toBe('631W')
    expect(liveValueForField(conflict('so_no', 'A', 'B'), { soNumber: 'S13784413' })).toBe('S13784413')
    expect(liveValueForField(conflict('hbl_awb_fcr_no', 'A', 'B'), { hblNumber: 'SE123' })).toBe('SE123')
    expect(liveValueForField(conflict('atd', 'A', 'B'), { actualDeparture: '2026-08-11' })).toBe('2026-08-11')
    // Reading leg['voyageNo'] would have returned undefined and silently settled nothing.
    expect(liveValueForField(conflict('voyage_no', '630W', '631W'), { voyageNo: '631W' })).toBeNull()
  })

  it('null when the leg does not carry the column, or the field maps nowhere', () => {
    expect(liveValueForField(conflict('vessel_name', 'A', 'B'), {})).toBeNull()
    expect(liveValueForField(conflict('vessel_name', 'A', 'B'), { vesselName: '' })).toBeNull()
    expect(liveValueForField(conflict('some_unmapped_field', 'A', 'B'), REAL_LEG)).toBeNull()
    expect(liveValueForField(conflict('vessel_name', 'A', 'B'), null)).toBeNull()
  })
})

describe('sameStoredValue', () => {
  it('text ignores case and whitespace shape', () => {
    expect(sameStoredValue('vesselName', 'maribo   maersk', 'MARIBO MAERSK')).toBe(true)
    expect(sameStoredValue('vesselName', 'MARIBO MAERSK', 'MAASTRICHT MAERSK')).toBe(false)
  })

  it('dates compare by day — the leg stores an instant, the email stated a date', () => {
    expect(sameStoredValue('etd', '2026-08-10', '2026-08-10T00:00:00.000Z')).toBe(true)
    expect(sameStoredValue('etd', '2026-08-10', '2026-08-11T00:00:00.000Z')).toBe(false)
  })

  it('numbers compare numerically, separators and trailing zeros included', () => {
    expect(sameStoredValue('qty', '8203', '8203.0')).toBe(true)
    expect(sameStoredValue('qty', '1,240', '1240')).toBe(true)
    expect(sameStoredValue('qty', '369', '784')).toBe(false)
  })
})

describe('isAppliedToLeg — commit-first leaves the critic snapshot stale', () => {
  it('settles the real leg: every proposal is already stored', () => {
    expect(isAppliedToLeg(conflict('vessel_name', 'MAASTRICHT MAERSK', 'MARIBO MAERSK'), REAL_LEG)).toBe(true)
    expect(isAppliedToLeg(conflict('voyage_no', '630W', '631W'), REAL_LEG)).toBe(true)
    expect(
      isAppliedToLeg(
        conflict(
          'consignee_address',
          'PRIMARK STORES (USD A/C), 41 WEST STREET HOUSE',
          'PRIMARK LTD, 22-24, PARNELL STREET, ARTHUR RYAN HOUSE, , Dublin Ireland',
        ),
        REAL_LEG,
      ),
    ).toBe(true)
  })

  it('a genuine disagreement stays open', () => {
    expect(isAppliedToLeg(conflict('vessel_name', 'MARIBO MAERSK', 'EVER GIVEN'), REAL_LEG)).toBe(false)
  })

  /**
   * The whole point of requiring EVERY offered value to match: one candidate agreeing with the leg
   * while another disagrees is still "which of these?", and hiding it would answer it for the operator.
   */
  it('does NOT settle when the candidates disagree with each other', () => {
    const c = conflict('vessel_name', 'OLD', 'MARIBO MAERSK', 'EVER GIVEN')
    expect(isAppliedToLeg(c, REAL_LEG)).toBe(false)
  })

  it('settles when two emails offered the SAME value the leg holds', () => {
    const c = conflict('vessel_name', 'OLD', 'MARIBO MAERSK', 'maribo maersk')
    expect(isAppliedToLeg(c, REAL_LEG)).toBe(true)
  })

  it('a resolved party matches by master CODE or by raw name — either could be what was written', () => {
    const byCode = {
      field: 'vendor_code',
      label: 'Vendor',
      candidates: [
        { value: '', source: 'system' },
        { value: 'FENIX FASHION LIMITED', source: 'SO', master: { code: 'FEFALT' } },
      ],
      rationale: 'x',
    } as CriticConflict
    expect(isAppliedToLeg(byCode, { vendorRaw: 'FEFALT' })).toBe(true)
    expect(isAppliedToLeg(byCode, { vendorRaw: 'FENIX FASHION LIMITED' })).toBe(true)
    expect(isAppliedToLeg(byCode, { vendorRaw: 'SOMEONE ELSE' })).toBe(false)
  })

  it('nothing offered but a system value → never settles (there was no proposal)', () => {
    expect(isAppliedToLeg(conflict('vessel_name', 'MARIBO MAERSK'), REAL_LEG)).toBe(false)
  })

  it('no live value → stays on the desk (the safe direction)', () => {
    expect(isAppliedToLeg(conflict('vessel_name', 'OLD', 'MARIBO MAERSK'), {})).toBe(false)
  })
})

describe('partitionAppliedConflicts', () => {
  it('splits the real leg into zero open decisions and three settled rows', () => {
    const { open, applied } = partitionAppliedConflicts(
      [
        conflict('vessel_name', 'MAASTRICHT MAERSK', 'MARIBO MAERSK'),
        conflict('voyage_no', '630W', '631W'),
        conflict('consignee_address', 'PRIMARK STORES (USD A/C), 41 WEST STREET HOUSE', REAL_LEG.consigneeAddress),
      ],
      REAL_LEG,
    )
    expect(open).toHaveLength(0)
    expect(applied.map((c) => c.field)).toEqual(['vessel_name', 'voyage_no', 'consignee_address'])
  })

  it('keeps order and keeps real disagreements open', () => {
    const { open, applied } = partitionAppliedConflicts(
      [
        conflict('vessel_name', 'MAASTRICHT MAERSK', 'MARIBO MAERSK'),
        conflict('voyage_no', '630W', '999X'),
      ],
      REAL_LEG,
    )
    expect(open.map((c) => c.field)).toEqual(['voyage_no'])
    expect(applied.map((c) => c.field)).toEqual(['vessel_name'])
  })
})
