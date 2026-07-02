import { describe, it, expect } from 'vitest'
import { isFiring, resolveThresholdHours, crdRevisionNotReflected, type Rule, type LegFacts } from './alert-rules'

const facts = (over: Partial<LegFacts> = {}): LegFacts => ({
  state: 'CONFIRMED',
  bookingRequestAt: null,
  cfsCutoff: null,
  atd: null,
  warehouseInAt: null,
  finalBlAt: null,
  originCountry: null,
  etd: null,
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

describe('resolveThresholdHours — per-origin-country override (Phase 3)', () => {
  const r = (over: Partial<Rule> = {}) =>
    rule({ thresholdHours: 72, countryThresholds: { CN: 72, BD: 168, KH: 168 }, ...over })

  it('returns the country override when the origin has one', () => {
    expect(resolveThresholdHours(r(), 'BD')).toBe(168)
    expect(resolveThresholdHours(r(), 'KH')).toBe(168)
  })

  it('falls back to thresholdHours when the country has no override', () => {
    expect(resolveThresholdHours(r(), 'VN')).toBe(72)
  })

  it('falls back to thresholdHours when originCountry is null or empty', () => {
    expect(resolveThresholdHours(r(), null)).toBe(72)
    expect(resolveThresholdHours(r(), '')).toBe(72)
  })

  it('falls back when countryThresholds is absent', () => {
    expect(resolveThresholdHours(rule({ thresholdHours: 24 }), 'BD')).toBe(24)
  })

  it('honors an explicit 0 override (key presence, not truthiness)', () => {
    expect(resolveThresholdHours(rule({ thresholdHours: 24, countryThresholds: { CN: 0 } }), 'CN')).toBe(0)
  })
})

describe('isFiring — country-aware A1, anchored on scheduled ETD (Phase 3)', () => {
  const a1 = (over: Partial<Rule> = {}) =>
    rule({
      id: 'A1', triggerType: 'days_after', triggerReference: 'etd', watchFor: 'draft_bl',
      thresholdHours: 24, countryThresholds: { BD: 48, KH: 48 }, ...over,
    })
  const etd = D('2026-02-01T00:00:00Z')

  it('CN leg fires once 24h past ETD with no Draft B/L', () => {
    expect(isFiring(a1(), facts({ etd, originCountry: 'CN' }), D('2026-02-02T01:00:00Z'))).toBe(true)
  })

  it('BD leg does NOT fire at 24h (BD threshold is 48h)', () => {
    expect(isFiring(a1(), facts({ etd, originCountry: 'BD' }), D('2026-02-02T01:00:00Z'))).toBe(false)
  })

  it('BD leg fires once 48h past ETD', () => {
    expect(isFiring(a1(), facts({ etd, originCountry: 'BD' }), D('2026-02-03T01:00:00Z'))).toBe(true)
  })

  it('does not fire once the Draft B/L has arrived', () => {
    expect(isFiring(a1(), facts({ etd, originCountry: 'CN', has: hasOf({ draftBl: true }) }), D('2026-02-10T00:00:00Z'))).toBe(false)
  })

  it('does not fire before ETD is known (anchor missing)', () => {
    expect(isFiring(a1(), facts({ etd: null, originCountry: 'CN' }), D('2026-02-10T00:00:00Z'))).toBe(false)
  })
})

describe('crdRevisionNotReflected (A7) — requested revision vs latest booking doc', () => {
  const D = (s: string) => new Date(s)

  it('fires on the WISEN shape: revision to Jul 8 requested, newer platform doc still shows Jun 29', () => {
    const finding = crdRevisionNotReflected(
      [
        { receivedAt: D('2026-06-30T04:23:00Z'), crd: '2026-07-08' }, // the multi-booking revision request
        { receivedAt: D('2026-06-30T05:51:00Z'), crd: '2026-06-29' }, // newer Expeditors notification, unrevised
      ],
      D('2026-06-29T00:00:00Z'),
    )
    expect(finding).not.toBeNull()
    expect(finding!.requested.toISOString().slice(0, 10)).toBe('2026-07-08')
  })

  it('stays silent once the newest document reflects the revision', () => {
    const finding = crdRevisionNotReflected(
      [
        { receivedAt: D('2026-06-30T04:23:00Z'), crd: '2026-07-08' },
        { receivedAt: D('2026-06-30T05:43:00Z'), crd: '2026-07-08' }, // platform revised (BX808346 V8)
      ],
      D('2026-07-08T00:00:00Z'),
    )
    expect(finding).toBeNull()
  })

  it('never flags a legitimate pull-forward (the later date is old and obsolete)', () => {
    const finding = crdRevisionNotReflected(
      [
        { receivedAt: D('2026-06-20T00:00:00Z'), crd: '2026-06-29' }, // original schedule, 10 days old
        { receivedAt: D('2026-06-30T00:00:00Z'), crd: '2026-06-25' }, // deliberately pulled forward
      ],
      D('2026-06-25T00:00:00Z'),
    )
    expect(finding).toBeNull()
  })

  it('needs at least two statements and a tracked value', () => {
    expect(crdRevisionNotReflected([{ receivedAt: D('2026-06-30T00:00:00Z'), crd: '2026-07-08' }], D('2026-06-29T00:00:00Z'))).toBeNull()
    expect(crdRevisionNotReflected([], D('2026-06-29T00:00:00Z'))).toBeNull()
    expect(
      crdRevisionNotReflected(
        [
          { receivedAt: D('2026-06-30T04:23:00Z'), crd: '2026-07-08' },
          { receivedAt: D('2026-06-30T05:51:00Z'), crd: '2026-06-29' },
        ],
        null,
      ),
    ).toBeNull()
  })
})
