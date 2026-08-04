import { describe, it, expect } from 'vitest'
import {
  isFiring,
  resolveThresholdHours,
  crdRevisionNotReflected,
  formatThresholdAlertMessage,
  type Rule,
  type LegFacts,
} from './alert-rules'

const facts = (over: Partial<LegFacts> = {}): LegFacts => ({
  state: 'CONFIRMED',
  bookingRequestAt: null,
  cfsCutoff: null,
  atd: null,
  warehouseInAt: null,
  draftBlAt: null,
  finalBlAt: null,
  originCountry: null,
  etd: null,
  eta: null,
  has: {
    so: false,
    draftBl: false,
    finalBl: false,
    telex: false,
    invoice: false,
    sailed: false,
    delivered: false,
  },
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
  it('A1: No Draft BOL — fires ETD+1 when draft still missing', () => {
    const r = rule({
      id: 'A1',
      state: null,
      triggerType: 'days_after',
      triggerReference: 'etd',
      watchFor: 'draft_bl',
      thresholdHours: 24,
      severity: 'WARNING',
    })
    expect(
      isFiring(r, facts({ etd: D('2026-02-01T00:00:00Z') }), D('2026-02-02T01:00:00Z')),
    ).toBe(true)
  })

  it('A1: does NOT fire once Draft B/L is received', () => {
    const r = rule({
      id: 'A1',
      state: null,
      triggerReference: 'etd',
      watchFor: 'draft_bl',
      thresholdHours: 24,
    })
    expect(
      isFiring(
        r,
        facts({ etd: D('2026-02-01T00:00:00Z'), has: hasOf({ draftBl: true }) }),
        D('2026-02-03T00:00:00Z'),
      ),
    ).toBe(false)
  })

  it('A1: does NOT fire before ETD+1', () => {
    const r = rule({
      id: 'A1',
      state: null,
      triggerReference: 'etd',
      watchFor: 'draft_bl',
      thresholdHours: 24,
    })
    expect(isFiring(r, facts({ etd: D('2026-02-10T00:00:00Z') }), D('2026-02-10T12:00:00Z'))).toBe(
      false,
    )
  })

  it('A2 critical: No Draft BOL at ETD+2', () => {
    const r = rule({
      id: 'A2',
      state: null,
      triggerReference: 'etd',
      watchFor: 'draft_bl',
      thresholdHours: 48,
      severity: 'CRITICAL',
    })
    expect(
      isFiring(r, facts({ etd: D('2026-02-01T00:00:00Z') }), D('2026-02-03T01:00:00Z')),
    ).toBe(true)
    expect(
      isFiring(r, facts({ etd: D('2026-02-01T00:00:00Z') }), D('2026-02-02T12:00:00Z')),
    ).toBe(false)
  })

  it('A3: No Final BOL — fires ETD+3 when final still missing', () => {
    const r = rule({
      id: 'A3',
      state: null,
      triggerReference: 'etd',
      watchFor: 'final_bl',
      thresholdHours: 72,
      severity: 'WARNING',
    })
    expect(
      isFiring(r, facts({ etd: D('2026-02-01T00:00:00Z') }), D('2026-02-04T01:00:00Z')),
    ).toBe(true)
    expect(
      isFiring(
        r,
        facts({ etd: D('2026-02-01T00:00:00Z'), has: hasOf({ finalBl: true }) }),
        D('2026-02-10T00:00:00Z'),
      ),
    ).toBe(false)
  })

  it('A4 critical: No Final BOL at ETD+7', () => {
    const r = rule({
      id: 'A4',
      state: null,
      triggerReference: 'etd',
      watchFor: 'final_bl',
      thresholdHours: 168,
      severity: 'CRITICAL',
    })
    expect(
      isFiring(r, facts({ etd: D('2026-02-01T00:00:00Z') }), D('2026-02-08T01:00:00Z')),
    ).toBe(true)
    expect(
      isFiring(r, facts({ etd: D('2026-02-01T00:00:00Z') }), D('2026-02-07T00:00:00Z')),
    ).toBe(false)
  })

  it('legacy: no SO within 2 days of booking still computable', () => {
    const r = rule({
      id: 'AX',
      state: 'BOOKED',
      triggerReference: 'booking_request',
      watchFor: 'so',
      thresholdHours: 48,
    })
    expect(
      isFiring(
        r,
        facts({ state: 'BOOKED', bookingRequestAt: D('2026-01-01T00:00:00Z') }),
        D('2026-01-03T01:00:00Z'),
      ),
    ).toBe(true)
    expect(
      isFiring(
        r,
        facts({ state: 'BOOKED', bookingRequestAt: D('2026-01-01T00:00:00Z') }),
        D('2026-01-02T00:00:00Z'),
      ),
    ).toBe(false)
  })

  it('A2 POC: days_before cut-off — fires inside the 1-day window', () => {
    const r = rule({
      id: 'A2',
      state: 'CONFIRMED',
      triggerType: 'days_before',
      triggerReference: 'cutoff',
      watchFor: 'draft_bl',
      thresholdHours: 24,
    })
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-04T00:00:00Z') }), D('2026-02-03T12:00:00Z'))).toBe(true)
    expect(isFiring(r, facts({ cfsCutoff: D('2026-02-10T00:00:00Z') }), D('2026-02-02T00:00:00Z'))).toBe(false)
  })

  it('state gate: A1 does not fire on SAILED even if SO missing', () => {
    const r = rule({
      id: 'A1',
      state: 'BOOKED',
      triggerReference: 'booking_request',
      watchFor: 'so',
      thresholdHours: 48,
    })
    expect(
      isFiring(
        r,
        facts({ state: 'SAILED', bookingRequestAt: D('2026-01-01T00:00:00Z') }),
        D('2026-01-10T00:00:00Z'),
      ),
    ).toBe(false)
  })

  it('A4: days since Draft B/L, no Final B/L', () => {
    const r = rule({
      id: 'A4',
      state: 'AT_WAREHOUSE',
      triggerReference: 'draft_bl',
      watchFor: 'final_bl',
      thresholdHours: 120,
    })
    expect(
      isFiring(
        r,
        facts({ state: 'AT_WAREHOUSE', draftBlAt: D('2026-02-01T00:00:00Z') }),
        D('2026-02-07T00:00:00Z'),
      ),
    ).toBe(true)
    expect(
      isFiring(
        r,
        facts({ state: 'AT_WAREHOUSE', draftBlAt: D('2026-02-01T00:00:00Z') }),
        D('2026-02-03T00:00:00Z'),
      ),
    ).toBe(false)
  })

  it('A5: days since Final B/L, no Telex', () => {
    const r = rule({
      id: 'A5',
      state: 'SAILED',
      triggerReference: 'final_bl',
      watchFor: 'telex',
      thresholdHours: 168,
    })
    expect(
      isFiring(r, facts({ state: 'SAILED', finalBlAt: D('2026-02-01T00:00:00Z') }), D('2026-02-09T00:00:00Z')),
    ).toBe(true)
  })

  it('A6: days past ETA, no delivery', () => {
    const r = rule({
      id: 'A6',
      state: 'RELEASED',
      triggerReference: 'eta',
      watchFor: 'delivered',
      thresholdHours: 72,
    })
    expect(isFiring(r, facts({ state: 'RELEASED', eta: D('2026-02-01T00:00:00Z') }), D('2026-02-05T00:00:00Z'))).toBe(
      true,
    )
    expect(
      isFiring(
        r,
        facts({ state: 'RELEASED', eta: D('2026-02-01T00:00:00Z'), has: hasOf({ delivered: true }) }),
        D('2026-02-05T00:00:00Z'),
      ),
    ).toBe(false)
  })

  it('does NOT fire when the reference anchor is missing', () => {
    expect(isFiring(rule({ triggerReference: 'departure', watchFor: 'telex' }), facts({ atd: null }), D('2026-06-01'))).toBe(
      false,
    )
  })

  it('a disabled rule never fires', () => {
    expect(isFiring(rule({ enabled: false }), facts({ cfsCutoff: D('2026-02-01') }), D('2026-03-01'))).toBe(false)
  })
})

describe('resolveThresholdHours — per-origin-country override', () => {
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

describe('isFiring — A2 country override on cut-off (days before)', () => {
  const a2 = (over: Partial<Rule> = {}) =>
    rule({
      id: 'A2',
      state: 'CONFIRMED',
      triggerType: 'days_before',
      triggerReference: 'cutoff',
      watchFor: 'draft_bl',
      thresholdHours: 24,
      countryThresholds: { BD: 48, KH: 48 },
      ...over,
    })
  const cutoff = D('2026-02-10T00:00:00Z')

  it('CN fires inside 24h before cut-off; BD needs 48h (fires earlier)', () => {
    // cutoff Feb 10; CN deadline Feb 9; BD deadline Feb 8
    // at Feb 9 12:00 both fire; at Feb 8 12:00 only BD; at Feb 8 00:00 neither? BD deadline exact: now > deadline
    expect(isFiring(a2(), facts({ cfsCutoff: cutoff, originCountry: 'CN' }), D('2026-02-09T12:00:00Z'))).toBe(true)
    expect(isFiring(a2(), facts({ cfsCutoff: cutoff, originCountry: 'BD' }), D('2026-02-09T12:00:00Z'))).toBe(true)
    expect(isFiring(a2(), facts({ cfsCutoff: cutoff, originCountry: 'CN' }), D('2026-02-08T12:00:00Z'))).toBe(false)
    expect(isFiring(a2(), facts({ cfsCutoff: cutoff, originCountry: 'BD' }), D('2026-02-08T12:00:00Z'))).toBe(true)
  })
})

describe('formatThresholdAlertMessage — flexible (not seed description)', () => {
  it('A1 days_after ETD: includes elapsed, threshold days, Draft B/L, and action', () => {
    const r = rule({
      id: 'A1',
      triggerType: 'days_after',
      triggerReference: 'etd',
      watchFor: 'draft_bl',
      thresholdHours: 24,
      severity: 'WARNING',
    })
    const msg = formatThresholdAlertMessage(
      r,
      facts({ etd: D('2026-02-01T00:00:00Z') }),
      D('2026-02-03T12:00:00Z'),
    )
    expect(msg).toContain('Draft B/L')
    expect(msg).toContain('ETD')
    expect(msg).toContain('2026-02-01')
    expect(msg).toMatch(/2 days/)
    expect(msg).toMatch(/threshold is ETD \+ 1 day/)
    expect(msg).toMatch(/Contact forwarder for Draft B\/L/)
    // Must not be the static seed blurb.
    expect(msg).not.toMatch(/Warning when Draft B\/L is still missing after ETD \+ N/)
  })

  it('A4 days_after ETD Final B/L: uses configured 7-day threshold and chase action', () => {
    const r = rule({
      id: 'A4',
      triggerType: 'days_after',
      triggerReference: 'etd',
      watchFor: 'final_bl',
      thresholdHours: 168,
      severity: 'CRITICAL',
    })
    const msg = formatThresholdAlertMessage(
      r,
      facts({ etd: D('2026-02-01T00:00:00Z') }),
      D('2026-02-10T00:00:00Z'),
    )
    expect(msg).toContain('Final B/L')
    expect(msg).toMatch(/threshold is ETD \+ 7 days/)
    expect(msg).toMatch(/Chase Final B\/L with forwarder/)
  })

  it('days_before cutoff: window phrasing, not "after"', () => {
    const r = rule({
      id: 'A2',
      triggerType: 'days_before',
      triggerReference: 'cutoff',
      watchFor: 'draft_bl',
      thresholdHours: 24,
    })
    const msg = formatThresholdAlertMessage(
      r,
      facts({ cfsCutoff: D('2026-02-10T00:00:00Z') }),
      D('2026-02-09T12:00:00Z'),
    )
    expect(msg).toContain('CFS cut-off')
    expect(msg).toContain('2026-02-10')
    expect(msg).toMatch(/1 day before/)
    expect(msg).not.toMatch(/after/)
  })

  it('country override changes the threshold phrase in the message', () => {
    const r = rule({
      id: 'A2',
      triggerType: 'days_after',
      triggerReference: 'etd',
      watchFor: 'draft_bl',
      thresholdHours: 48,
      countryThresholds: { BD: 96 },
    })
    const msg = formatThresholdAlertMessage(
      r,
      facts({ etd: D('2026-02-01T00:00:00Z'), originCountry: 'BD' }),
      D('2026-02-06T00:00:00Z'),
    )
    expect(msg).toMatch(/threshold is ETD \+ 4 days/)
  })

  it('derives action from watchFor, not rule id (legacy SO rule)', () => {
    const r = rule({
      id: 'AX',
      triggerType: 'days_after',
      triggerReference: 'booking_request',
      watchFor: 'so',
      thresholdHours: 48,
    })
    const msg = formatThresholdAlertMessage(
      r,
      facts({ bookingRequestAt: D('2026-01-01T00:00:00Z') }),
      D('2026-01-04T00:00:00Z'),
    )
    expect(msg).toMatch(/SO \/ booking confirmation/)
    expect(msg).toMatch(/Contact forwarder for SO/)
  })
})

describe('crdRevisionNotReflected (A7) — requested revision vs latest booking doc', () => {
  const D = (s: string) => new Date(s)

  it('fires on the WISEN shape: revision to Jul 8 requested, newer platform doc still shows Jun 29', () => {
    const finding = crdRevisionNotReflected(
      [
        { receivedAt: D('2026-06-30T04:23:00Z'), crd: '2026-07-08' },
        { receivedAt: D('2026-06-30T05:51:00Z'), crd: '2026-06-29' },
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
        { receivedAt: D('2026-06-30T05:43:00Z'), crd: '2026-07-08' },
      ],
      D('2026-07-08T00:00:00Z'),
    )
    expect(finding).toBeNull()
  })

  it('never flags a legitimate pull-forward (the later date is old and obsolete)', () => {
    const finding = crdRevisionNotReflected(
      [
        { receivedAt: D('2026-06-20T00:00:00Z'), crd: '2026-06-29' },
        { receivedAt: D('2026-06-30T00:00:00Z'), crd: '2026-06-25' },
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

/**
 * False "chase the forwarder" banners found on a live leg (202601256B): AIR, DELIVERED, holding
 * MAWB 098-32230085 and HAWB GZL26258522, every milestone except FINAL_BL_RECEIVED — and a CRITICAL
 * "No Final B/L — 175 days after ETD. Chase Final B/L with forwarder."
 */
describe('document chases must be about a document that exists and an action still possible', () => {
  it('a delivered leg is not chased for a pre-arrival document', () => {
    const r = rule({
      id: 'A3',
      state: null,
      triggerReference: 'etd',
      watchFor: 'final_bl',
      thresholdHours: 24,
    })
    const etd = D('2026-02-03T00:00:00Z')
    const now = D('2026-07-28T00:00:00Z')
    expect(isFiring(r, facts({ etd }), now)).toBe(true)
    expect(isFiring(r, facts({ etd, has: hasOf({ delivered: true }) }), now)).toBe(false)
  })

  it('the invoice chase survives delivery — that one is still actionable', () => {
    const r = rule({
      id: 'A6',
      state: null,
      triggerReference: 'etd',
      watchFor: 'invoice',
      thresholdHours: 24,
    })
    const etd = D('2026-02-03T00:00:00Z')
    expect(
      isFiring(r, facts({ etd, has: hasOf({ delivered: true }) }), D('2026-07-28T00:00:00Z')),
    ).toBe(true)
  })
})

describe('a DISABLED rule must not fire — including the built-in A7', () => {
  // A1-A6 go through isFiring(), which returns false on `!rule.enabled`. A7 is evaluated by its own
  // bespoke path that never read the flag, so an A7 switched OFF in settings kept raising WARNINGs and
  // its existing alerts never resolved. These pin the contract the UI implies: off means off.
  it('isFiring() refuses a disabled rule regardless of the facts', () => {
    const facts = {
      state: 'AT_WAREHOUSE',
      originCountry: 'KH',
      etd: new Date('2026-07-16T00:00:00Z'),
      has: { so: false, draftBl: false, finalBl: false, telex: false, invoice: false, sailed: false, delivered: false },
    } as unknown as Parameters<typeof isFiring>[1]
    const base = {
      id: 'A1',
      watchFor: 'draft_bl',
      triggerReference: 'etd',
      thresholdHours: 24,
      countryThresholds: null,
      severity: 'WARNING',
      state: null,
    }
    const now = new Date('2026-07-30T00:00:00Z')
    expect(isFiring({ ...base, enabled: true } as Parameters<typeof isFiring>[0], facts, now)).toBe(true)
    expect(isFiring({ ...base, enabled: false } as Parameters<typeof isFiring>[0], facts, now)).toBe(false)
  })
})
