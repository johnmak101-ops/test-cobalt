import { describe, it, expect } from 'vitest'
import { deriveMilestoneRows, deriveEmailRows } from './milestone-rows'
import { MILESTONE_OF, DERIVED_MILESTONE_OF } from './state'
import { MILESTONE_TYPE } from '../db/enums'

const ev = (emailType: string, receivedAt: string, graphId?: string | null) => ({ emailType, receivedAt, graphId })

describe('milestone_type integrity — every emittable type is in the enum + CHECK constraint', () => {
  // Regression guard for the missing-'SAILED' bug: deriveMilestoneRows emitted 'SAILED' but it was absent
  // from MILESTONE_TYPE / ck_shipment_milestones_type, so every sailed shipment's milestone INSERT threw the
  // CHECK violation — which aborted sync() before the related-email write (blank timeline + no Related Emails).
  const allowed = new Set<string>(MILESTONE_TYPE)
  it("includes 'SAILED' (the derived departure milestone the UI reads and committer emits)", () => {
    expect(allowed.has('SAILED')).toBe(true)
  })
  it('every email-mapped milestone type is allowed', () => {
    for (const mt of Object.values(MILESTONE_OF)) expect(allowed.has(mt)).toBe(true)
  })
  it('every field-derived milestone type is allowed', () => {
    for (const { milestone } of DERIVED_MILESTONE_OF) expect(allowed.has(milestone)).toBe(true)
  })
  it('the SAILED etd-fallback row uses an allowed type', () => {
    const rows = deriveMilestoneRows('s1', [], { etd: '2026-02-10' }, 'SAILED')
    for (const r of rows) expect(allowed.has(r.milestoneType as string)).toBe(true)
  })
})

describe('deriveMilestoneRows — email-mapped + field-derived milestones (pure)', () => {
  it('maps each source-email type to its milestone, dated by receivedAt', () => {
    const rows = deriveMilestoneRows('s1', [ev('SO', '2026-02-02'), ev('Booking Request', '2026-02-01')], {}, 'BOOKED')
    const byType = Object.fromEntries(rows.map((r) => [r.milestoneType, r.occurredAt]))
    expect(byType.BOOKING_SENT).toEqual(new Date('2026-02-01'))
    expect(byType.SO_RECEIVED).toEqual(new Date('2026-02-02'))
  })

  it('emits field-derived milestones (warehouse_start_date→AT_WAREHOUSE, atd→SAILED), dated by the field', () => {
    const rows = deriveMilestoneRows('s1', [], { warehouse_start_date: '2026-02-05', atd: '2026-02-08' }, 'SAILED')
    const sailed = rows.find((r) => (r.milestoneType as string) === 'SAILED')!
    const wh = rows.find((r) => r.milestoneType === 'AT_WAREHOUSE')!
    expect(sailed.occurredAt).toEqual(new Date('2026-02-08'))
    expect(sailed.notes).toBe('derived')
    expect(wh.occurredAt).toEqual(new Date('2026-02-05'))
  })

  it('SAILED fallback: state SAILED with no atd uses etd; a single SAILED when atd exists; none off-SAILED', () => {
    const fromEtd = deriveMilestoneRows('s1', [], { etd: '2026-02-10' }, 'SAILED')
    const s = fromEtd.find((r) => (r.milestoneType as string) === 'SAILED')!
    expect(s.occurredAt).toEqual(new Date('2026-02-10'))
    expect(s.notes).toBe('derived from etd')
    // atd present → SAILED comes from atd, exactly one SAILED row (no double-emit)
    const fromAtd = deriveMilestoneRows('s1', [], { atd: '2026-02-08', etd: '2026-02-10' }, 'SAILED')
    const sailedRows = fromAtd.filter((r) => (r.milestoneType as string) === 'SAILED')
    expect(sailedRows).toHaveLength(1)
    expect(sailedRows[0]!.occurredAt).toEqual(new Date('2026-02-08'))
    // state not SAILED → no etd fallback
    expect(deriveMilestoneRows('s1', [], { etd: '2026-02-10' }, 'BOOKED').some((r) => (r.milestoneType as string) === 'SAILED')).toBe(false)
  })

  it('🔴 the etd-backfill also fires when deriveState OVERSHOT to RELEASED/DELIVERED (transit-allowance fallback)', () => {
    // Measured: an AIR leg judged DELIVERED by the no-arrival-data fallback showed a six-stage story
    // with NO departure row, the ETD sitting right on the leg — the old `state === 'SAILED'` guard
    // never held because the state never rested on SAILED.
    for (const state of ['RELEASED', 'DELIVERED']) {
      const rows = deriveMilestoneRows('s1', [], { etd: '2026-07-18' }, state, new Date('2026-08-03'))
      const s = rows.find((r) => (r.milestoneType as string) === 'SAILED')!
      expect(s.occurredAt).toEqual(new Date('2026-07-18'))
      expect(s.notes).toBe('derived from etd')
    }
  })

  it('🔴 a FUTURE etd never mints a departure — the stamp is an assumption the clock must back', () => {
    // A rescheduled ETD (pushed to next week) with a state some other signal already advanced must not
    // write "sailed next Tuesday" into the timeline.
    const rows = deriveMilestoneRows('s1', [], { etd: '2026-08-20' }, 'DELIVERED', new Date('2026-08-03'))
    expect(rows.some((r) => (r.milestoneType as string) === 'SAILED')).toBe(false)
    // and the atd-derived SAILED is untouched by the clock guard — a stated atd is a FACT, not a guess
    const fact = deriveMilestoneRows('s1', [], { atd: '2026-08-20' }, 'DELIVERED', new Date('2026-08-03'))
    expect(fact.filter((r) => (r.milestoneType as string) === 'SAILED')).toHaveLength(1)
  })
})

describe('deriveEmailRows — related emails deduped by graph id (pure)', () => {
  it('keeps every event that has a graphId (deduped, first-seen), drops those without', () => {
    const rows = deriveEmailRows('s1', [
      ev('SO', '2026-02-01', 'g1'),
      ev('Other', '2026-02-02', 'g1'), // dup graph id → dropped
      ev('Customs', '2026-02-03', 'g2'),
      ev('Other', '2026-02-04', null), // no graph id → dropped
    ])
    expect(rows.map((r) => r.graphMessageId)).toEqual(['g1', 'g2'])
    expect(rows.find((r) => r.graphMessageId === 'g2')!.emailType).toBe('Customs')
  })

  it('empty events → empty rows (replaceEmails must not wipe existing links when callers pass this)', () => {
    expect(deriveEmailRows('s1', [])).toEqual([])
    expect(deriveEmailRows('s1', [ev('SO', '2026-02-01', null)])).toEqual([])
  })
})

describe('a source event with no receivedAt must not mint a 1970 milestone', () => {
  // `new Date(null)` is EPOCH ZERO, not an error. On a real commit run 9 of 38 milestones landed on
  // 1970-01-01 — all email-derived, because this loop lacked the null guard the field-derived loop has.
  //
  // The consequence was not cosmetic: a phantom DRAFT_BL_RECEIVED@1970 on a leg with NO hbl/mbl made the
  // alert evaluator's `has.draftBl` true, so it judged the draft-B/L watch satisfied and suppressed the
  // "No Draft B/L" alert on a shipment that had never received one.
  const emailType = Object.keys(MILESTONE_OF)[0]!

  it('skips the milestone when receivedAt is null', () => {
    const rows = deriveMilestoneRows('s1', [{ emailType, receivedAt: null as unknown as string }], {}, 'BOOKED')
    expect(rows.filter((r) => r.milestoneType === MILESTONE_OF[emailType])).toHaveLength(0)
  })

  it('skips the milestone when receivedAt is an unparseable string', () => {
    const rows = deriveMilestoneRows('s1', [ev(emailType, 'not-a-date')], {}, 'BOOKED')
    expect(rows.filter((r) => r.milestoneType === MILESTONE_OF[emailType])).toHaveLength(0)
  })

  it('NO emitted milestone is ever dated at or before the unix epoch', () => {
    const rows = deriveMilestoneRows(
      's1',
      [{ emailType, receivedAt: null as unknown as string }, ev(Object.keys(MILESTONE_OF)[1] ?? emailType, '2026-07-16T00:00:00Z')],
      { warehouse_start_date: '2026-07-16', atd: '2026-07-20' },
      'SAILED',
    )
    for (const r of rows) {
      expect(new Date(r.occurredAt as Date).getTime()).toBeGreaterThan(0)
    }
  })

  it('still emits normally when receivedAt is a real date', () => {
    const rows = deriveMilestoneRows('s1', [ev(emailType, '2026-07-16T09:30:00Z')], {}, 'BOOKED')
    const hit = rows.find((r) => r.milestoneType === MILESTONE_OF[emailType])
    expect(hit).toBeDefined()
    expect((hit!.occurredAt as Date).toISOString()).toBe('2026-07-16T09:30:00.000Z')
  })
})
