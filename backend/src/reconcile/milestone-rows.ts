/**
 * Pure milestone/related-email row derivation, extracted from committer.syncMilestones so the subtle timeline
 * rules (email-type mapping, field-derived milestones, the SAILED etd-fallback, graph-id dedup) are unit-tested
 * in isolation. No I/O — the committer's thin syncMilestones shell persists the returned rows.
 */
import type { Insertable } from 'kysely'
import type { DB } from '../db/kysely/db'
import { MILESTONE_OF, DERIVED_MILESTONE_OF } from './state'
import { date } from './match-keys'

type MilestoneRow = Insertable<DB['shipmentMilestones']>
type EmailRow = Insertable<DB['shipmentEmails']>
type SourceEvent = { emailType: string; receivedAt: string; graphId?: string | null }

/** Milestone rows for a leg: one per source-email type (dated by receivedAt), plus field-derived milestones
 *  (warehouse_start_date→AT_WAREHOUSE, atd→SAILED) and a SAILED etd-fallback. Idempotent per milestone type. */
/** States at or past physical departure — the SAILED etd-backfill applies to every one of them,
 *  because deriveState can OVERSHOOT straight to RELEASED/DELIVERED (transit-allowance fallback)
 *  without ever resting on SAILED. */
const DEPARTED_OR_BEYOND = new Set(['SAILED', 'RELEASED', 'DELIVERED'])

export function deriveMilestoneRows(
  shipmentId: string,
  events: SourceEvent[],
  fields: Record<string, unknown>,
  state: string,
  /** System clock — injectable for tests. The etd-backfill may only assume a departure that the
   *  calendar says already happened. */
  now: Date = new Date(),
): MilestoneRow[] {
  const seen = new Set<string>()
  const rows: MilestoneRow[] = []
  for (const ev of [...events].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    const mt = MILESTONE_OF[ev.emailType]
    if (!mt || seen.has(mt)) continue
    seen.add(mt)
    rows.push({
      shipmentId,
      milestoneType: mt as MilestoneRow['milestoneType'],
      occurredAt: new Date(ev.receivedAt),
      senderType: 'forwarder',
      emailMessageId: ev.graphId ?? null, // graph id → "view original" re-fetch
    })
  }
  // BUG 7: also emit milestones DERIVED from field presence (warehouse_start_date → AT_WAREHOUSE,
  // atd → SAILED), dated by that field, so the timeline matches the state deriveState already reached from
  // the same fields. Idempotent via `seen` (a field-derived type never duplicates an email-derived one of
  // the same type). Only when the field has a parseable date.
  for (const { field, milestone } of DERIVED_MILESTONE_OF) {
    if (seen.has(milestone)) continue
    const occurredAt = date(fields[field])
    if (!occurredAt) continue
    seen.add(milestone)
    rows.push({
      shipmentId,
      milestoneType: milestone as MilestoneRow['milestoneType'],
      occurredAt,
      senderType: 'forwarder',
      notes: 'derived', // field-derived, not email-type-mapped
    })
  }
  // BUG 3: deriveState can reach SAILED via the Invoice/Billing + mbl + past-etd path with atd NULL, so the
  // atd→SAILED derived milestone above never fires and the timeline shows a blank departure. When the committed
  // state IS SAILED but no SAILED milestone was emitted (neither email- nor atd-derived) and atd is absent,
  // emit one dated by etd. Idempotent via `seen`; never double-emits when atd already produced a SAILED row.
  //
  // Extended (2026-08-03): the same blank departure reappeared one state further along — deriveState's
  // no-arrival-data transit allowance OVERSHOOTS straight to DELIVERED, skipping SAILED, so the
  // `state === 'SAILED'` guard never held. Measured on a real AIR leg (ETD 7/18, judged DELIVERED on
  // 8/3): six-stage story, no departure row, the ETD sitting right on the leg. Any state at or past
  // departure now backfills — but ONLY when the etd has PASSED on the system clock: the stamp is an
  // assumption, and a future ETD must never mint a departure that has not happened yet.
  if (DEPARTED_OR_BEYOND.has(state) && !seen.has('SAILED') && !date(fields.atd)) {
    const etd = date(fields.etd)
    if (etd && etd.getTime() <= now.getTime()) {
      seen.add('SAILED')
      rows.push({
        shipmentId,
        milestoneType: 'SAILED' as MilestoneRow['milestoneType'],
        occurredAt: etd,
        senderType: 'forwarder',
        notes: 'derived from etd',
      })
    }
  }
  return rows
}

/** Related-emails rows: EVERY source email deduped by graph id — including unmapped "Other"/Customs emails
 *  that carry the shipment's data but map to no milestone, so they were invisible before. */
export function deriveEmailRows(shipmentId: string, events: SourceEvent[]): EmailRow[] {
  const seen = new Set<string>()
  const rows: EmailRow[] = []
  for (const ev of events) {
    if (!ev.graphId || seen.has(ev.graphId)) continue
    seen.add(ev.graphId)
    rows.push({ shipmentId, graphMessageId: ev.graphId, emailType: ev.emailType, receivedAt: new Date(ev.receivedAt) })
  }
  return rows
}
