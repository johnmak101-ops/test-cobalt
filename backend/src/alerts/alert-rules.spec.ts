import { describe, it, expect } from 'vitest'
import { isFiring, type Rule, type LegFacts } from './alert-rules'

const facts = (over: Partial<LegFacts> = {}): LegFacts => ({
  state: 'CONFIRMED',
  bookingRequestAt: null,
  cfsCutoff: null,
  atd: null,
  warehouseInAt: null,
  finalBlAt: null,
  has: { so: false, draftBl: false, finalBl: false, telex: false, invoice: false, sailed: false },
  ...over,
})
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'AX',
  triggerType: 'days_after',
  triggerReference: 'cutoff',
  watchFor: 'final_bl',
  thresholdHours: 0,
  severity: 'WARNING',
  enabled: true,
  ...over,
})
const D = (s: string) => new Date(s)
const hasOf = (over: Partial<LegFacts['has']>) => ({ ...facts().has, ...over })

describe('isFiring — Pillar-4 rule logic', () => {
  it('A3: cut-off passed and no Final B/L → fires (Critical)', () => {
    const r = rule({ id: 'A3', triggerReference: 'cutoff', watchFor: 'final_bl', thresholdHours: 0, severity: 'CRITICAL' })
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-01') }), D('2026-02-02'))).toBe(true)
  })

  it('A3: does NOT fire once Final B/L is received', () => {
    const r = rule({ triggerReference: 'cutoff', watchFor: 'final_bl' })
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-01'), has: hasOf({ finalBl: true }) }), D('2026-02-02'))).toBe(false)
  })

  it('A3: does NOT fire before the cut-off', () => {
    const r = rule({ triggerReference: 'cutoff', watchFor: 'final_bl', thresholdHours: 0 })
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-10') }), D('2026-02-02'))).toBe(false)
  })

  it('A1: no SO within 48h of booking → fires after the window, not before', () => {
    const r = rule({ id: 'A1', triggerReference: 'booking_request', watchFor: 'so', thresholdHours: 48 })
    expect(isFiring(r, facts({ bookingRequestAt: D('2026-01-01T00:00:00Z') }), D('2026-01-03T01:00:00Z'))).toBe(true)
    expect(isFiring(r, facts({ bookingRequestAt: D('2026-01-01T00:00:00Z') }), D('2026-01-02T00:00:00Z'))).toBe(false)
  })

  it('A2: days_before cut-off — fires inside the 72h window, not outside', () => {
    const r = rule({ triggerType: 'days_before', triggerReference: 'cutoff', watchFor: 'draft_bl', thresholdHours: 72 })
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-04T00:00:00Z') }), D('2026-02-02T00:00:00Z'))).toBe(true)
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-10T00:00:00Z') }), D('2026-02-02T00:00:00Z'))).toBe(false)
  })

  it('does NOT fire when the reference anchor is missing (rule not yet applicable)', () => {
    expect(isFiring(rule({ triggerReference: 'departure', watchFor: 'telex' }), facts({ atd: null }), D('2026-06-01'))).toBe(false)
  })

  it('a disabled rule never fires', () => {
    expect(isFiring(rule({ enabled: false }), facts({ cfsCutoff: D('2026-02-01') }), D('2026-03-01'))).toBe(false)
  })
})
