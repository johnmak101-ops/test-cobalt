import { describe, it, expect } from 'vitest'
import { deriveState, normMode, MILESTONE_OF } from './state'

describe('deriveState — 6-state staircase', () => {
  it('defaults to BOOKED', () => {
    expect(deriveState(new Set(), {})).toBe('BOOKED')
  })
  it('SO present → CONFIRMED', () => {
    expect(deriveState(new Set(['SO']), {})).toBe('CONFIRMED')
    expect(deriveState(new Set(), { so_no: 'X' })).toBe('CONFIRMED')
  })
  it('Draft B/L or warehouse date → AT_WAREHOUSE', () => {
    expect(deriveState(new Set(['Draft B/L']), {})).toBe('AT_WAREHOUSE')
    expect(deriveState(new Set(), { warehouse_start_date: '2026-02-01' })).toBe('AT_WAREHOUSE')
  })
  it('actual departure → SAILED', () => {
    expect(deriveState(new Set(['Draft B/L']), { atd: '2026-02-10' })).toBe('SAILED')
  })
  it('Telex / Final B/L → RELEASED', () => {
    expect(deriveState(new Set(['Telex Release']), {})).toBe('RELEASED')
  })
  it('in-DC date alone does NOT reach DELIVERED without a departure signal', () => {
    // a delivery cannot precede departure — in_dc with no atd/Final B/L/Telex stays at the prior stage
    expect(deriveState(new Set(['SO']), { in_dc_date: '2026-03-01' })).toBe('CONFIRMED')
  })
  it('in-DC date + departure (atd) → DELIVERED (highest reached wins)', () => {
    expect(deriveState(new Set(['SO']), { in_dc_date: '2026-03-01', atd: '2026-02-20' })).toBe('DELIVERED')
  })
})

describe('normMode', () => {
  it('maps known labels', () => {
    expect(normMode('Sea')).toBe('SEA')
    expect(normMode('Sea-LCL')).toBe('SEA_LCL')
    expect(normMode('Air')).toBe('AIR')
  })
  it('falls back by prefix, null when unknown', () => {
    expect(normMode('sea freight')).toBe('SEA')
    expect(normMode('air cargo')).toBe('AIR')
    expect(normMode('rail')).toBeNull()
    expect(normMode(null)).toBeNull()
  })
})

describe('MILESTONE_OF', () => {
  it('maps email types to milestones', () => {
    expect(MILESTONE_OF['Booking Request']).toBe('BOOKING_SENT')
    expect(MILESTONE_OF['Final B/L']).toBe('FINAL_BL_RECEIVED')
    expect(MILESTONE_OF['Other']).toBeUndefined()
  })
})
