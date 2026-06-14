import { Injectable } from '@nestjs/common'
import type * as schema from '@cobalt/contracts'
import { isFiring, type LegFacts } from './alert-rules'
import { AlertRepository } from '../db/repositories/alert.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'

const SAILED_STATES = new Set(['SAILED', 'RELEASED', 'DELIVERED'])

/** Evaluates the A1-A6 rules against every active leg and fires (deduped) alerts. */
@Injectable()
export class AlertEvaluatorService {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly shipments: ShipmentRepository,
  ) {}

  async evaluate(now: Date = new Date()): Promise<{ evaluated: number; fired: number }> {
    const rules = await this.alerts.enabledRules()
    const legs = await this.shipments.activeLegs()

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
    return { evaluated: legs.length, fired }
  }

  private async buildFacts(leg: typeof schema.shipments.$inferSelect): Promise<LegFacts> {
    const ms = await this.shipments.milestonesFor(leg.id)
    const at = (t: string) => ms.find((m) => m.milestoneType === t)?.occurredAt ?? null
    return {
      state: leg.state,
      bookingRequestAt: at('BOOKING_SENT'),
      cfsCutoff: leg.cfsCutoff,
      atd: leg.atd,
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
