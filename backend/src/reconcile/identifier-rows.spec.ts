import { describe, it, expect } from 'vitest'
import { deriveIdentifierRows, currentIdentifierValues } from './identifier-rows'

const id = (type: string, value: string, over: Record<string, unknown> = {}) => ({ type, value, ...over })

describe('currentIdentifierValues — alnum of each committed identity column', () => {
  it('maps leg columns to type→alnum, skipping null/empty', () => {
    const cur = currentIdentifierValues({ soNo: 'SO-1', bookingNo: 'bk 2', hblAwbFcrNo: null, mbl: '', containerNo: 'CT1' })
    expect(cur).toEqual({ so_no: 'SO1', booking_no: 'BK2', container_no: 'CT1' })
  })
})

describe('deriveIdentifierRows — identifier history rows (cross-type dedup + is_current)', () => {
  it('keeps a value shared across types only under its highest-priority type (booking_no > mbl > hbl > so)', () => {
    const rows = deriveIdentifierRows('s1', [id('so_no', 'X100'), id('booking_no', 'X100')], {})
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe('booking_no')
  })

  it('marks is_current when the value equals the committed column OR the agent flagged it', () => {
    const rows = deriveIdentifierRows(
      's1',
      [id('so_no', 'SO-1'), id('booking_no', 'BK-9', { isCurrent: true }), id('mbl', 'M-2')],
      { so_no: 'SO1' }, // committed so_no column
    )
    const byType = Object.fromEntries(rows.map((r) => [r.type, r.isCurrent]))
    expect(byType.so_no).toBe(true) // normKey('SO-1') === committed 'SO1'
    expect(byType.booking_no).toBe(true) // agent isCurrent
    expect(byType.mbl).toBe(false) // neither
  })

  it('dedupes identical type+value and drops types outside the identity set', () => {
    const rows = deriveIdentifierRows('s1', [id('so_no', 'SO-1'), id('so_no', 'SO-1'), id('customer_po', 'PO-1')], {})
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type).toBe('so_no')
  })

  it('does NOT cross-type dedup container_no (in the set but not priority-ranked)', () => {
    const rows = deriveIdentifierRows('s1', [id('container_no', 'C100'), id('so_no', 'C100')], {})
    expect(rows.map((r) => r.type).sort()).toEqual(['container_no', 'so_no'])
  })
})
