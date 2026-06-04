import { eq, and } from 'drizzle-orm'
import { shipments, shipmentMilestones, alerts, alertRules } from '../db/schema.js'
import type { ShipmentStatus, MilestoneType } from '../types/index.js'
import crypto from 'node:crypto'

/**
 * Step 4: ALERT EVALUATOR — Rules-based alert engine.
 * Evaluates all active alert rules against each shipment's
 * current state and milestone history. Creates alerts when
 * thresholds are exceeded.
 *
 * Key principle (from PRD): Alerts are based on "time since last milestone"
 * rather than "distance to known date" — because Cobalt only knows CRD upfront.
 * All other dates come from forwarder emails.
 */

// Maps shipment status to the milestone type that should have been reached
const STATUS_TO_EXPECTED_MILESTONE: Record<string, MilestoneType[]> = {
  BOOKED: ['SO_RECEIVED'],
  CONFIRMED: ['DRAFT_BL_RECEIVED'],
  AT_WAREHOUSE: ['FINAL_BL_RECEIVED'],
  SAILED: ['TELEX_RELEASED'],
  RELEASED: ['DELIVERED'],
}

// Maps rule trigger_reference to the milestone that serves as the reference point
const TRIGGER_REF_TO_MILESTONE: Record<string, MilestoneType> = {
  booking: 'BOOKING_SENT',
  draft_bl: 'DRAFT_BL_RECEIVED',
  final_bl: 'FINAL_BL_RECEIVED',
}

interface AlertRule {
  id: string
  name: string
  description: string
  state: string
  triggerType: string
  triggerReference: string
  thresholdDays: number
  severity: string
  enabled: boolean
  locked: boolean
}

interface EvaluationResult {
  alertsCreated: number
  alertsResolved: number
  shipmentsEvaluated: number
}

/**
 * Evaluate all alert rules against all active shipments.
 * Creates new alerts when rules are triggered, resolves alerts
 * when conditions are no longer met.
 */
export async function evaluateAlerts(db: any): Promise<EvaluationResult> {
  let alertsCreated = 0
  let alertsResolved = 0

  // Load all enabled alert rules
  const rules: AlertRule[] = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.enabled, true))

  // Load all active shipments (not DELIVERED)
  const activeShipments = await db.select().from(shipments)
  const nonDelivered = activeShipments.filter(
    (s: any) => s.status !== 'DELIVERED'
  )

  const now = new Date()

  for (const shipment of nonDelivered) {
    // Load milestones for this shipment
    const milestones = await db
      .select()
      .from(shipmentMilestones)
      .where(eq(shipmentMilestones.shipmentId, shipment.id))

    const milestoneTypes = new Set<string>(milestones.map((m: any) => m.milestoneType))
    const milestoneMap = new Map<string, any>(
      milestones.map((m: any) => [m.milestoneType, m])
    )

    // Check each rule against this shipment
    for (const rule of rules) {
      // Rule only applies to shipments in the matching state
      if (shipment.status !== rule.state) continue

      const shouldAlert = evaluateRule(
        rule,
        shipment,
        milestoneTypes,
        milestoneMap,
        now
      )

      // Check if alert already exists for this shipment + rule combo
      const existingAlert = await db
        .select()
        .from(alerts)
        .where(
          and(
            eq(alerts.shipmentId, shipment.id),
            eq(alerts.ruleId, rule.id),
            eq(alerts.status, 'ACTIVE' as any)
          )
        )
        .get()

      if (shouldAlert && !existingAlert) {
        // Create new alert
        await db.insert(alerts).values({
          id: crypto.randomUUID(),
          shipmentId: shipment.id,
          ruleId: rule.id,
          severity: rule.severity,
          message: generateAlertMessage(rule, shipment, milestoneMap),
          status: 'ACTIVE',
          triggeredAt: now,
        })
        alertsCreated++
      } else if (!shouldAlert && existingAlert) {
        // Resolve alert — condition no longer met
        await db
          .update(alerts)
          .set({ status: 'RESOLVED' })
          .where(eq(alerts.id, existingAlert.id))
        alertsResolved++
      }
    }
  }

  return {
    alertsCreated,
    alertsResolved,
    shipmentsEvaluated: nonDelivered.length,
  }
}

/**
 * Evaluate a single rule against a single shipment.
 * Returns true if the alert condition is met.
 */
function evaluateRule(
  rule: AlertRule,
  shipment: any,
  milestoneTypes: Set<string>,
  milestoneMap: Map<string, any>,
  now: Date
): boolean {
  const expectedMilestones = STATUS_TO_EXPECTED_MILESTONE[rule.state]
  if (!expectedMilestones) return false

  // If the expected next milestone already exists, no alert needed
  const hasExpectedMilestone = expectedMilestones.some((m) =>
    milestoneTypes.has(m)
  )
  if (hasExpectedMilestone) return false

  if (rule.triggerType === 'days_after') {
    // "days_after" — check time since a reference milestone or date
    const refMilestone = TRIGGER_REF_TO_MILESTONE[rule.triggerReference]

    let referenceDate: Date | null = null

    if (refMilestone && milestoneMap.has(refMilestone)) {
      referenceDate = new Date(milestoneMap.get(refMilestone).occurredAt)
    } else if (rule.triggerReference === 'cutoff' && shipment.cfsCutoff) {
      referenceDate = new Date(shipment.cfsCutoff)
    } else if (rule.triggerReference === 'eta' && shipment.eta) {
      referenceDate = new Date(shipment.eta)
    }

    if (!referenceDate) return false

    const daysSince = (now.getTime() - referenceDate.getTime()) / 86400000
    return daysSince >= rule.thresholdDays
  }

  if (rule.triggerType === 'days_before') {
    // "days_before" — check time until a future date
    let targetDate: Date | null = null

    if (rule.triggerReference === 'cutoff' && shipment.cfsCutoff) {
      targetDate = new Date(shipment.cfsCutoff)
    } else if (rule.triggerReference === 'eta' && shipment.eta) {
      targetDate = new Date(shipment.eta)
    }

    if (!targetDate) return false

    const daysUntil = (targetDate.getTime() - now.getTime()) / 86400000
    return daysUntil <= rule.thresholdDays && daysUntil >= 0
  }

  return false
}

/**
 * Generate a human-readable alert message based on the rule and shipment context.
 */
function generateAlertMessage(
  rule: AlertRule,
  shipment: any,
  milestoneMap: Map<string, any>
): string {
  const refMilestone = TRIGGER_REF_TO_MILESTONE[rule.triggerReference]
  const refEvent = refMilestone ? milestoneMap.get(refMilestone) : null

  switch (rule.id) {
    case 'A1': {
      const bookingEvent = milestoneMap.get('BOOKING_SENT')
      const days = bookingEvent
        ? Math.floor(
            (Date.now() - new Date(bookingEvent.occurredAt).getTime()) / 86400000
          )
        : '?'
      return `Booking sent ${days} days ago — no Shipping Order received from forwarder`
    }
    case 'A2':
      return `CFS cut-off approaching — no Draft B/L received yet`
    case 'A3':
      return `Cut-off passed — cargo may have missed the vessel`
    case 'A4': {
      const days = refEvent
        ? Math.floor(
            (Date.now() - new Date(refEvent.occurredAt).getTime()) / 86400000
          )
        : '?'
      return `No Final B/L received ${days} days after Draft B/L`
    }
    case 'A5': {
      const days = refEvent
        ? Math.floor(
            (Date.now() - new Date(refEvent.occurredAt).getTime()) / 86400000
          )
        : '?'
      return `No Telex Release ${days} days after Final B/L — check freight payment status`
    }
    case 'A6':
      return `ETA has passed — no delivery confirmation received`
    default:
      return rule.description
  }
}

/**
 * Evaluate alerts for a single shipment (used after email processing).
 * More efficient than re-evaluating all shipments.
 */
export async function evaluateAlertsForShipment(
  db: any,
  shipmentId: string
): Promise<{ created: number; resolved: number }> {
  let created = 0
  let resolved = 0

  const shipment = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .get()

  if (!shipment || shipment.status === 'DELIVERED') {
    return { created, resolved }
  }

  const rules: AlertRule[] = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.enabled, true))

  const milestones = await db
    .select()
    .from(shipmentMilestones)
    .where(eq(shipmentMilestones.shipmentId, shipmentId))

  const milestoneTypes = new Set<string>(milestones.map((m: any) => m.milestoneType))
  const milestoneMap = new Map<string, any>(
    milestones.map((m: any) => [m.milestoneType, m])
  )
  const now = new Date()

  for (const rule of rules) {
    if (shipment.status !== rule.state) continue

    const shouldAlert = evaluateRule(
      rule,
      shipment,
      milestoneTypes,
      milestoneMap,
      now
    )

    const existingAlert = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.shipmentId, shipmentId),
          eq(alerts.ruleId, rule.id),
          eq(alerts.status, 'ACTIVE' as any)
        )
      )
      .get()

    if (shouldAlert && !existingAlert) {
      await db.insert(alerts).values({
        id: crypto.randomUUID(),
        shipmentId,
        ruleId: rule.id,
        severity: rule.severity,
        message: generateAlertMessage(rule, shipment, milestoneMap),
        status: 'ACTIVE',
        triggeredAt: now,
      })
      created++
    } else if (!shouldAlert && existingAlert) {
      await db
        .update(alerts)
        .set({ status: 'RESOLVED' })
        .where(eq(alerts.id, existingAlert.id))
      resolved++
    }
  }

  return { created, resolved }
}
