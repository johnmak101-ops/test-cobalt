import { describe, it, expect } from 'vitest'
import { deriveMilestoneRows, deriveEmailRows } from './milestone-rows'

const ev = (emailType: string, receivedAt: string, graphId?: string | null) => ({ emailType, receivedAt, graphId })

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
