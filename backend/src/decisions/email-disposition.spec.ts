import { describe, it, expect } from 'vitest'
import { resolveEmailDisposition } from './email-disposition'
import type { CreateDecisionDto } from './dto'

const base = (over: Partial<CreateDecisionDto> = {}): CreateDecisionDto => ({
  matchKey: { so_no: 'SO-1' },
  fields: { so_no: 'SO-1' },
  pos: ['PO-1'],
  confidence: 90,
  ...over,
})

describe('resolveEmailDisposition', () => {
  it('auto: new PO + known customer', () => {
    const r = resolveEmailDisposition(base({
      pos: ['PO-NEW'],
      lookupContext: { knownCustomer: true },
      disposition: undefined,
    }))
    expect(r.disposition).toBe('auto')
  })

  it('review: new/unknown customer signal', () => {
    const r = resolveEmailDisposition(base({
      lookupContext: { newCustomer: true, knownCustomer: false },
      disposition: 'auto', // agent said auto — track escalates
      autoApply: true,
    }))
    expect(r.disposition).toBe('review')
    expect(r.reasons.some((x) => /customer is new or not recognized/i.test(x))).toBe(true)
  })

  it('review: mode-change / moved / late-PO / dup-number', () => {
    for (const key of ['modeChange', 'movedShipment', 'latePo', 'duplicateNumber'] as const) {
      const r = resolveEmailDisposition(base({ lookupContext: { [key]: true }, disposition: 'auto' }))
      expect(r.disposition).toBe('review')
    }
  })

  it('skip: no PO, no strong id, no status update (不需處理)', () => {
    const r = resolveEmailDisposition(base({
      matchKey: {},
      pos: [],
      fields: { note: 'fyi' },
      disposition: undefined,
      lookupContext: { statusUpdate: false },
    }))
    expect(r.disposition).toBe('skip')
    expect(r.reasons.some((x) => /不需處理|not actionable/i.test(x))).toBe(true)
  })

  it('honours explicit skip disposition when no review signal', () => {
    expect(resolveEmailDisposition(base({ disposition: 'skip' })).disposition).toBe('skip')
  })

  it('review signal beats explicit auto disposition (safe direction)', () => {
    expect(
      resolveEmailDisposition(base({ disposition: 'auto', lookupContext: { modeChange: true } })).disposition,
    ).toBe('review')
  })
})
