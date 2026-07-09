import { Injectable } from '@nestjs/common'
import type * as schema from '../db/contracts'
import { isFiring, crdRevisionNotReflected, type LegFacts } from './alert-rules'
import { AlertRepository } from '../db/repositories/alert.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { EmailRepository } from '../db/repositories/email.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'

const SAILED_STATES = new Set(['SAILED', 'RELEASED', 'DELIVERED'])

/** A7 is a BUILT-IN check (evidence vs tracked value), not a threshold rule — the row exists only so
 *  fired alerts have a rule id; enabled=false keeps it out of the threshold loop and the settings UI
 *  can still show/describe it. */
const A7_RULE = {
  id: 'A7',
  name: 'Requested cargo-ready revision not reflected',
  description:
    'An email requested a LATER cargo-ready date but the newest booking document still shows the old one — confirm the revision with the forwarder. (Built-in check; thresholds not configurable.)',
  triggerType: 'days_after',
  triggerReference: 'booking_request',
  watchFor: 'so',
  thresholdHours: 0,
  severity: 'WARNING',
  enabled: false,
  locked: true,
} as const

/** Evaluates the A1-A6 rules against every active leg and fires (deduped) alerts. */
@Injectable()
export class AlertEvaluatorService {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly shipments: ShipmentRepository,
    private readonly emails: EmailRepository,
    private readonly evidence: EvidenceRepository,
  ) {}

  async evaluate(now: Date = new Date()): Promise<{ evaluated: number; fired: number }> {
    const rules = await this.alerts.enabledRules()
    const legs = await this.shipments.activeConfirmedLegs() // commit-first: never alert on provisional legs
    const milestonesByShipment = await this.shipments.milestonesForShipments(legs.map((l) => l.id))

    let fired = 0
    for (const leg of legs) {
      const facts = this.buildFacts(leg, milestonesByShipment.get(leg.id) ?? [])
      for (const rule of rules) {
        if (!isFiring(rule, facts, now)) continue
        const isNew = await this.alerts.insertDeduped({
          ruleId: rule.id,
          bookingId: leg.bookingId,
          shipmentId: leg.id,
          severity: rule.severity as never,
          message: rule.description ?? rule.id,
          dedupKey: `${rule.id}:${leg.id}`,
          firedAt: now,
        })
        if (isNew) fired++
      }
    }
    fired += await this.evaluateCrdRevisions(legs, now)
    return { evaluated: legs.length, fired }
  }

  /** A7: a requested cargo-ready revision the newest booking document doesn't reflect. */
  private async evaluateCrdRevisions(
    legs: Array<typeof schema.shipments.$inferSelect>,
    now: Date,
  ): Promise<number> {
    await this.alerts.ensureRule(A7_RULE as never)
    const candidates = legs.filter((leg) => leg.cargoReadyDate && !SAILED_STATES.has(leg.state))
    if (!candidates.length) return 0
    // Bulk: emails for every candidate leg, then ONE evidence load for all their messages grouped by
    // messageId — was emailsForShipment + forMessages PER leg.
    const emailsByShipment = await this.emails.emailsForShipments(candidates.map((l) => l.id))
    const evidenceRows = await this.evidence.forMessages([
      ...new Set([...emailsByShipment.values()].flat().map((e) => e.id)),
    ])
    const evidenceByMessage = new Map<string, (typeof evidenceRows)[number][]>()
    for (const ev of evidenceRows) {
      const arr = evidenceByMessage.get(ev.messageId)
      if (arr) arr.push(ev)
      else evidenceByMessage.set(ev.messageId, [ev])
    }
    const norm = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    let fired = 0
    for (const leg of candidates) {
      const related = emailsByShipment.get(leg.id) ?? []
      if (related.length < 2) continue
      const evidence = related.flatMap((r) => evidenceByMessage.get(r.id) ?? [])
      // a multi-booking email's sibling records must not speak for this leg
      const ids: Array<[string, string | null]> = [
        ['booking_no', leg.bookingNo], ['so_no', leg.soNo], ['hbl_awb_fcr_no', leg.hblAwbFcrNo],
        ['mbl', leg.mbl], ['container_no', leg.containerNo],
      ]
      const statements = evidence
        .filter((e) => !ids.some(([f, v]) => {
          const rv = norm((e.fields as Record<string, unknown>)?.[f])
          const sv = norm(v)
          return rv && sv && rv !== sv
        }))
        .map((e) => ({ receivedAt: e.receivedAt, crd: ((e.fields as Record<string, unknown>)?.cargo_ready_date as string | null) ?? null }))
      const finding = crdRevisionNotReflected(statements, leg.cargoReadyDate)
      if (!finding) continue
      const day = (d: Date) => d.toISOString().slice(0, 10)
      const isNew = await this.alerts.insertDeduped({
        ruleId: 'A7',
        bookingId: leg.bookingId,
        shipmentId: leg.id,
        severity: 'WARNING',
        message: `Cargo-ready revision to ${day(finding.requested)} requested, but the latest booking document still shows ${day(finding.current)} — confirm the new date with the forwarder`,
        dedupKey: `A7:${leg.id}:${day(finding.requested)}`,
        firedAt: now,
      })
      if (isNew) fired++
    }
    return fired
  }

  private buildFacts(
    leg: typeof schema.shipments.$inferSelect,
    ms: (typeof schema.shipmentMilestones.$inferSelect)[],
  ): LegFacts {
    const at = (t: string) => ms.find((m) => m.milestoneType === t)?.occurredAt ?? null
    return {
      state: leg.state,
      originCountry: leg.originCountry ?? null,
      bookingRequestAt: at('BOOKING_SENT'),
      // CFS cut-off ≡ 截倉時間 ≡ warehouse_end_date (soul field 12): the parser only ever fills
      // warehouse_end_date; cfs_cutoff fills solely from a human edit. A cutoff-anchored alert must see
      // either, so fall back to the warehouse end date — mirrors the presentation mapper's equating.
      cfsCutoff: leg.cfsCutoff ?? leg.warehouseEndDate,
      atd: leg.atd,
      etd: leg.etd,
      warehouseInAt: at('AT_WAREHOUSE') ?? leg.warehouseStartDate,
      finalBlAt: at('FINAL_BL_RECEIVED'),
      has: {
        so: !!at('SO_RECEIVED') || !!leg.soNo,
        draftBl: !!at('DRAFT_BL_RECEIVED'),
        finalBl: !!at('FINAL_BL_RECEIVED'),
        telex: !!at('TELEX_RELEASED'),
        invoice: !!at('INVOICE_RECEIVED'),
        sailed: SAILED_STATES.has(leg.state),
      },
    }
  }
}
