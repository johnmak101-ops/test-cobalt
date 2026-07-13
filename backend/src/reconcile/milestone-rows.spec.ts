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
