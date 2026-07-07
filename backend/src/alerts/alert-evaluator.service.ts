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

    let fired = 0
    for (const leg of legs) {
      const facts = await this.buildFacts(leg)
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
    const norm = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    let fired = 0
    for (const leg of legs) {
      if (!leg.cargoReadyDate || SAILED_STATES.has(leg.state)) continue
      const related = await this.emails.emailsForShipment(leg.id)
      if (related.length < 2) continue
      const evidence = await this.evidence.forMessages(related.map((r) => r.id))
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

  private async buildFacts(leg: typeof schema.shipments.$inferSelect): Promise<LegFacts> {
    const ms = await this.shipments.milestonesFor(leg.id)
    const at = (t: string) => ms.find((m) => m.milestoneType === t)?.occurredAt ?? null
    return {
      state: leg.state,
      originCountry: leg.originCountry ?? null,
      bookingRequestAt: at('BOOKING_SENT'),
      cfsCutoff: leg.cfsCutoff,
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
