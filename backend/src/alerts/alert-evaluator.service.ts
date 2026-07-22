import { Injectable } from '@nestjs/common'
import type { Selectable } from 'kysely'
import type { DB } from '../db/kysely/db'
import {
  isFiring,
  crdRevisionNotReflected,
  formatThresholdAlertMessage,
  type LegFacts,
  type Rule,
} from './alert-rules'
import { AlertRepository } from '../db/repositories/alert.repository'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { EmailRepository } from '../db/repositories/email.repository'
import { EvidenceRepository } from '../db/repositories/evidence.repository'

const SAILED_STATES = new Set(['SAILED', 'RELEASED', 'DELIVERED'])
/** Threshold rules that participate in fire + auto-resolve (not A7 built-in). */
const THRESHOLD_RULE_IDS = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'])

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

export type EvaluateResult = { evaluated: number; fired: number; resolved: number }

/** Evaluates the A1-A6 rules against every active confirmed leg, fires new alerts, and auto-resolves
 *  ACTIVE threshold alerts that no longer match. */
@Injectable()
export class AlertEvaluatorService {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly shipments: ShipmentRepository,
    private readonly emails: EmailRepository,
    private readonly evidence: EvidenceRepository,
  ) {}

  async evaluate(now: Date = new Date()): Promise<EvaluateResult> {
    const rawRules = await this.alerts.enabledRules()
    const rules = rawRules.map(normalizeRule)
    const allRulesById = new Map(
      (await this.alerts.allRules()).map((r) => [r.id, normalizeRule(r)] as const),
    )
    const legs = await this.shipments.activeConfirmedLegs()
    const milestonesByShipment = await this.shipments.milestonesForShipments(legs.map((l) => l.id))
    const factsByLeg = new Map<string, LegFacts>()
    for (const leg of legs) {
      factsByLeg.set(leg.id, this.buildFacts(leg, milestonesByShipment.get(leg.id) ?? []))
    }

    let fired = 0
    for (const leg of legs) {
      const facts = factsByLeg.get(leg.id)!
      for (const rule of rules) {
        if (!THRESHOLD_RULE_IDS.has(rule.id)) continue
        if (!isFiring(rule, facts, now)) continue
        // Live facts + rule thresholds — not the static seed description.
        const message = formatThresholdAlertMessage(rule, facts, now)
        const dedupKey = `${rule.id}:${leg.id}`
        const isNew = await this.alerts.insertDeduped({
          ruleId: rule.id,
          bookingId: leg.bookingId,
          shipmentId: leg.id,
          severity: rule.severity as never,
          message,
          dedupKey,
          firedAt: now,
        })
        if (isNew) {
          fired++
        } else {
          // Already ACTIVE for this rule+leg — push current severity/message so Settings edits apply.
          await this.alerts.refreshActiveByDedupKey(dedupKey, {
            severity: rule.severity,
            message,
          })
        }
      }
    }
    fired += await this.evaluateCrdRevisions(legs, now)

    // Auto-resolve ACTIVE threshold alerts that no longer fire (threshold change / milestone arrived).
    let resolved = 0
    const active = await this.alerts.list('ACTIVE')
    for (const alert of active) {
      if (!THRESHOLD_RULE_IDS.has(alert.ruleId)) continue
      if (!alert.shipmentId) continue
      const rule = allRulesById.get(alert.ruleId)
      if (!rule) {
        // Free dedup key so a future fire can insert a new ACTIVE row.
        await this.alerts.setStatus(alert.id, 'RESOLVED', {
          resolvedAt: now,
          dedupKey: `${alert.dedupKey ?? alert.id}:resolved:${alert.id}`,
        })
        resolved++
        continue
      }
      const facts = factsByLeg.get(alert.shipmentId)
      // Leg left confirmed-active set, rule disabled, or conditions no longer met → resolve.
      if (!facts || !rule.enabled || !isFiring(rule, facts, now)) {
        await this.alerts.setStatus(alert.id, 'RESOLVED', {
          resolvedAt: now,
          dedupKey: `${alert.dedupKey ?? alert.id}:resolved:${alert.id}`,
        })
        resolved++
      }
    }

    return { evaluated: legs.length, fired, resolved }
  }

  /** A7: a requested cargo-ready revision the newest booking document doesn't reflect. */
  private async evaluateCrdRevisions(
    legs: Array<Selectable<DB['shipments']>>,
    now: Date,
  ): Promise<number> {
    await this.alerts.ensureRule(A7_RULE as never)
    const candidates = legs.filter((leg) => leg.cargoReadyDate && !SAILED_STATES.has(leg.state))
    if (!candidates.length) return 0
    const emailsByShipment = await this.emails.emailsForShipments(candidates.map((l) => l.id))
    const evidenceRows = await this.evidence.forMessages([
      ...new Set(
        [...emailsByShipment.values()]
          .flat()
          .map((e) => e.id)
          .filter((id): id is string => id != null),
      ),
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
      const related = (emailsByShipment.get(leg.id) ?? []).filter(
        (r): r is typeof r & { id: string } => r.id != null,
      )
      if (related.length < 2) continue
      const evidence = related.flatMap((r) => evidenceByMessage.get(r.id) ?? [])
      const ids: Array<[string, string | null]> = [
        ['booking_no', leg.bookingNo],
        ['so_no', leg.soNo],
        ['hbl_awb_fcr_no', leg.hblAwbFcrNo],
        ['mbl', leg.mbl],
        ['container_no', leg.containerNo],
      ]
      const statements = evidence
        .filter((e) =>
          !ids.some(([f, v]) => {
            const rv = norm((e.fields as Record<string, unknown>)?.[f])
            const sv = norm(v)
            return rv && sv && rv !== sv
          }),
        )
        .map((e) => ({
          receivedAt: e.receivedAt,
          crd: ((e.fields as Record<string, unknown>)?.cargo_ready_date as string | null) ?? null,
        }))
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
    leg: Selectable<DB['shipments']>,
    ms: Selectable<DB['shipmentMilestones']>[],
  ): LegFacts {
    const at = (t: string) => ms.find((m) => m.milestoneType === t)?.occurredAt ?? null
    const draftBlAt = at('DRAFT_BL_RECEIVED')
    const finalBlAt = at('FINAL_BL_RECEIVED')
    return {
      state: leg.state,
      originCountry: leg.originCountry ?? null,
      bookingRequestAt: at('BOOKING_SENT'),
      // CFS cut-off ≡ warehouse_end_date (soul field 12): parser fills warehouse_end_date; cfs_cutoff
      // fills solely from human edit. Cutoff-anchored alerts must see either.
      cfsCutoff: leg.cfsCutoff ?? leg.warehouseEndDate,
      atd: leg.atd,
      etd: leg.etd,
      eta: leg.eta,
      warehouseInAt: at('AT_WAREHOUSE') ?? leg.warehouseStartDate,
      draftBlAt,
      finalBlAt,
      has: {
        so: !!at('SO_RECEIVED') || !!leg.soNo,
        draftBl: !!draftBlAt,
        finalBl: !!finalBlAt,
        telex: !!at('TELEX_RELEASED'),
        invoice: !!at('INVOICE_RECEIVED'),
        sailed: SAILED_STATES.has(leg.state),
        delivered: leg.state === 'DELIVERED' || !!at('DELIVERED') || !!leg.inDcDate,
      },
    }
  }
}

/** Map a DB alert_rules row into the pure Rule shape (JSON country thresholds, description). */
function normalizeRule(row: {
  id: string
  state?: string | null
  triggerType: string
  triggerReference: string
  watchFor: string
  thresholdHours: number | null
  countryThresholds?: Record<string, number> | string | null
  severity: string
  enabled: boolean
  description?: string | null
  name?: string
}): Rule & { description?: string | null } {
  let countryThresholds: Record<string, number> | null = null
  const raw = row.countryThresholds
  if (raw != null) {
    if (typeof raw === 'string') {
      try {
        countryThresholds = JSON.parse(raw) as Record<string, number>
      } catch {
        countryThresholds = null
      }
    } else {
      countryThresholds = raw
    }
  }
  return {
    id: row.id,
    state: row.state ?? null,
    triggerType: row.triggerType as Rule['triggerType'],
    triggerReference: row.triggerReference,
    watchFor: row.watchFor,
    thresholdHours: row.thresholdHours ?? 0,
    countryThresholds,
    severity: row.severity,
    enabled: row.enabled,
    description: row.description ?? null,
  }
}
