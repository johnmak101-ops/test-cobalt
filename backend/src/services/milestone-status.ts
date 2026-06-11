/**
 * Single source of truth: shipment status is always derived from milestones.
 *
 * Mapping (last completed milestone → status):
 *   DELIVERED         → DELIVERED
 *   TELEX_RELEASED    → RELEASED
 *   FINAL_BL_RECEIVED → SAILED
 *   DRAFT_BL_RECEIVED → AT_WAREHOUSE
 *   SO_RECEIVED       → CONFIRMED
 *   BOOKING_SENT      → BOOKED
 *   (none)            → BOOKED
 */

import { eq } from 'drizzle-orm'
import { shipments, shipmentMilestones } from '../db/schema.js'
import type { ShipmentStatus, MilestoneType } from '../types/index.js'

/** Milestone order from earliest to latest */
const MILESTONE_ORDER: MilestoneType[] = [
  'BOOKING_SENT',
  'SO_RECEIVED',
  'DRAFT_BL_RECEIVED',
  'FINAL_BL_RECEIVED',
  'TELEX_RELEASED',
  'DELIVERED',
]

/** Maps each milestone to the shipment status it represents */
const MILESTONE_TO_STATUS: Record<MilestoneType, ShipmentStatus> = {
  BOOKING_SENT: 'BOOKED',
  SO_RECEIVED: 'CONFIRMED',
  DRAFT_BL_RECEIVED: 'AT_WAREHOUSE',
  FINAL_BL_RECEIVED: 'SAILED',
  TELEX_RELEASED: 'RELEASED',
  DELIVERED: 'DELIVERED',
}

/**
 * Derive shipment status from a set of completed milestone types.
 * Returns the status corresponding to the latest completed milestone.
 */
export function deriveStatusFromMilestones(
  completedMilestones: string[]
): ShipmentStatus {
  const completed = new Set(completedMilestones)

  // Walk backwards from the latest milestone
  for (let i = MILESTONE_ORDER.length - 1; i >= 0; i--) {
    if (completed.has(MILESTONE_ORDER[i])) {
      return MILESTONE_TO_STATUS[MILESTONE_ORDER[i]]
    }
  }

  // No milestones at all → BOOKED
  return 'BOOKED'
}

/**
 * Recompute and persist a shipment's status from its milestones.
 * Returns the new status.
 */
export async function recomputeShipmentStatus(
  db: any,
  shipmentId: string
): Promise<ShipmentStatus> {
  const milestones = await db
    .select({ milestoneType: shipmentMilestones.milestoneType })
    .from(shipmentMilestones)
    .where(eq(shipmentMilestones.shipmentId, shipmentId))

  const types = milestones.map((m: any) => m.milestoneType)
  const newStatus = deriveStatusFromMilestones(types)

  await db
    .update(shipments)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(shipments.id, shipmentId))

  return newStatus
}
