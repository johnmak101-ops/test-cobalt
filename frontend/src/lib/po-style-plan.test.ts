import { describe, it, expect } from 'vitest'
import { planAll, planForPo, styleTokens } from './po-style-plan'

const po = (over: Partial<{ id: string; poNumber: string; itemStyleNo: string | null }> = {}) => ({
  id: 'po1',
  poNumber: '1570988',
  itemStyleNo: '8921345, 8921747',
  ...over,
})

describe('styleTokens', () => {
  it('splits on comma, semicolon and the CJK comma, trimming blanks', () => {
    expect(styleTokens('A, B;C，D')).toEqual(['A', 'B', 'C', 'D'])
    expect(styleTokens('  A ,, ')).toEqual(['A'])
    expect(styleTokens(null)).toEqual([])
  })
})

describe('planForPo', () => {
  it('is null when nothing is ticked either way — an untouched PO is not a write', () => {
    expect(planForPo(po(), '8921347/round-neck pullover', undefined)).toBeNull()
    expect(planForPo(po(), '8921347/round-neck pullover', { dropped: [], added: false })).toBeNull()
  })

  it('adds the seen value to the end, keeping what is there', () => {
    const p = planForPo(po(), '8921347/round-neck pullover', { added: true })
    expect(p?.itemStyleNo).toBe('8921345, 8921747, 8921347/round-neck pullover')
    expect(p?.clears).toBe(false)
  })

  it('drops an unticked token', () => {
    const p = planForPo(po({ itemStyleNo: '8921345, 8921747, abcdfsdfsdf' }), null, {
      dropped: ['abcdfsdfsdf'],
    })
    expect(p?.itemStyleNo).toBe('8921345, 8921747')
  })

  it('drops and adds in one go — the case the two columns exist for', () => {
    const p = planForPo(po({ itemStyleNo: '8921345, abcdfsdfsdf' }), '8921347/round-neck pullover', {
      dropped: ['abcdfsdfsdf'],
      added: true,
    })
    expect(p?.itemStyleNo).toBe('8921345, 8921347/round-neck pullover')
  })

  it('matches dropped tokens case-insensitively', () => {
    const p = planForPo(po({ itemStyleNo: 'Abc, Def' }), null, { dropped: ['ABC'] })
    expect(p?.itemStyleNo).toBe('Def')
  })

  /** alsoSeenStyleForPo refuses to offer a value the PO already carries — but the operator can untick
   *  the token that made it a duplicate and re-tick it here, and the list must not hold it twice. */
  it('never writes the same token twice', () => {
    const p = planForPo(po({ itemStyleNo: 'A, B' }), 'b', { added: true })
    expect(p).toBeNull() // 'b' already present (case-insensitive) → nothing changes
    const q = planForPo(po({ itemStyleNo: 'A, B' }), 'B, C', { added: true })
    expect(q?.itemStyleNo).toBe('A, B, C')
  })

  it('flags a clear — the one outcome that destroys data', () => {
    const p = planForPo(po({ itemStyleNo: 'A, B' }), null, { dropped: ['A', 'B'] })
    expect(p?.itemStyleNo).toBe('')
    expect(p?.clears).toBe(true)
  })

  /** Re-joining an unchanged list can normalise spacing; writing a PO to reformat it is not a change
   *  the operator asked for, and it would put the leg in the audit trail for nothing. */
  it('does not call a whitespace-only reformat a change', () => {
    expect(planForPo(po({ itemStyleNo: '8921345,8921747' }), null, { dropped: [] })).toBeNull()
  })

  it('adds to a PO that had no styles at all', () => {
    const p = planForPo(po({ itemStyleNo: null }), 'C192/FERN JUMPER', { added: true })
    expect(p?.itemStyleNo).toBe('C192/FERN JUMPER')
    expect(p?.clears).toBe(false)
  })
})

describe('planAll', () => {
  it('returns only the POs that change — the count the button names', () => {
    const pos = [
      po({ id: 'a', poNumber: 'A', itemStyleNo: 'X' }),
      po({ id: 'b', poNumber: 'B', itemStyleNo: 'Y' }),
      po({ id: 'c', poNumber: 'C', itemStyleNo: 'Z' }),
    ]
    const plans = planAll(pos, (p) => (p.poNumber === 'C' ? null : 'NEW'), {
      a: { added: true },
      // b untouched
    })
    expect(plans.map((p) => p.poNumber)).toEqual(['A'])
    expect(plans[0]!.itemStyleNo).toBe('X, NEW')
  })
})
