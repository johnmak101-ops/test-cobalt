import { describe, it, expect } from 'vitest'
import { evaluate, catalogView, REVIEW_TRIGGER_IDS } from './review-policy'
import type { CreateDecisionDto } from './dto'

const base = (over: Partial<CreateDecisionDto> = {}): CreateDecisionDto => ({
  matchKey: { so_no: 'SO-1' },
  fields: { so_no: 'SO-1', booking_no: 'BK-1' },
  pos: ['PO-1'],
  conflicts: [],
  confidence: 90,
  ...over,
})

describe('review-policy evaluate', () => {
  it('returns nothing when the policy is empty, even if a condition matches', () => {
    expect(evaluate({ enabled: [] }, base({ conflicts: ['x'] }))).toEqual([])
  })
  it('conflict fires only when enabled AND a conflict exists', () => {
    expect(evaluate({ enabled: ['conflict'] }, base({ conflicts: ['x'] }))).toHaveLength(1)
    expect(evaluate({ enabled: ['conflict'] }, base({ conflicts: [] }))).toEqual([])
  })
  it('no_strong_id fires when matchKey has no strong key', () => {
    expect(evaluate({ enabled: ['no_strong_id'] }, base({ matchKey: { customer_po: 'PO-1' } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['no_strong_id'] }, base({ matchKey: { booking_no: 'BK-1' } }))).toEqual([])
  })
  it('no_po fires when pos is empty', () => {
    expect(evaluate({ enabled: ['no_po'] }, base({ pos: [] }))).toHaveLength(1)
  })
  it('cancellation fires on a cancelled decision', () => {
    expect(evaluate({ enabled: ['cancellation'] }, base({ cancelled: true }))).toHaveLength(1)
  })
  it('platform_only fires when fromPlatform', () => {
    expect(evaluate({ enabled: ['platform_only'] }, base({ fromPlatform: true }))).toHaveLength(1)
  })
  it('brand_present / in_dc_date fire only when those fields are set', () => {
    expect(evaluate({ enabled: ['brand_present'] }, base({ fields: { brand: 'FENIX' } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['brand_present'] }, base({ fields: {} }))).toEqual([])
    expect(evaluate({ enabled: ['in_dc_date'] }, base({ fields: { in_dc_date: '2026-07-01' } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['in_dc_date'] }, base({ fields: { etd: '2026-07-01' } }))).toEqual([])
  })
  it('sparse fires when fewer than 2 fields are populated', () => {
    expect(evaluate({ enabled: ['sparse'] }, base({ fields: { so_no: 'SO-1' } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['sparse'] }, base({ fields: { so_no: 'SO-1', booking_no: 'BK-1' } }))).toEqual([])
  })
  it('ignores unknown ids in the policy', () => {
    expect(evaluate({ enabled: ['made_up'] }, base({ conflicts: ['x'] }))).toEqual([])
  })
  it('returns every matched enabled trigger', () => {
    expect(evaluate({ enabled: ['no_po', 'conflict'] }, base({ pos: [], conflicts: ['x'] }))).toHaveLength(2)
  })
  it('v2 lookup triggers fire only when lookupContext signals are set', () => {
    expect(evaluate({ enabled: ['new_customer'] }, base({ lookupContext: { newCustomer: true } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['mode_change'] }, base({ lookupContext: { modeChange: true } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['moved_shipment'] }, base({ lookupContext: { movedShipment: true } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['duplicate_number'] }, base({ lookupContext: { duplicateNumber: true } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['late_po'] }, base({ lookupContext: { latePo: true } }))).toHaveLength(1)
    expect(evaluate({ enabled: ['new_customer'] }, base({}))).toEqual([])
  })
})

describe('review-policy catalogView', () => {
  it('lists the whole catalog with enabled flags', () => {
    const view = catalogView(['conflict'])
    expect(view.length).toBe(REVIEW_TRIGGER_IDS.length)
    expect(view.find((t) => t.id === 'conflict')?.enabled).toBe(true)
    expect(view.find((t) => t.id === 'no_po')?.enabled).toBe(false)
    expect(view.every((t) => typeof t.label === 'string' && t.label.length > 0)).toBe(true)
  })
})
