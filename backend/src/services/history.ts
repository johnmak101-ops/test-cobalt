import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { shipments, shipmentHistory } from '../db/schema.js'
import type { HistorySourceType, HistoryField } from '../types/index.js'

/**
 * Shipment History Tracker — centralized audit trail for all field changes.
 * 
 * Every shipment update (from pipeline, manual edit, or system) should go
 * through trackShipmentUpdate() instead of raw db.update(). This function:
 * 1. Reads the current shipment state
 * 2. Diffs incoming updates against current values
 * 3. Inserts a shipment_history row for each changed field
 * 4. Applies the update to the shipment
 * 5. Detects delays (new ETA > old ETA)
 */

// Fields we track in the audit trail
const TRACKED_FIELDS: Record<string, HistoryField> = {
  etd: 'etd',
  eta: 'eta',
  vesselName: 'vessel_name',
  status: 'status',
  cfsCutoff: 'cfs_cutoff',
  hblNumber: 'hbl_number',
  voyageNumber: 'voyage_number',
  quantityShipped: 'quantity_shipped',
  riskLevel: 'risk_level',
}

// Format a value for display in history records
function formatValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

interface TrackOptions {
  sourceType: HistorySourceType
  sourceId?: string  // email_id if from email processing
  changedBy?: string // user ID if manual edit
  notes?: string
}

export interface TrackResult {
  fieldsChanged: number
  delaysDetected: number
  changes: Array<{
    field: HistoryField
    oldValue: string | null
    newValue: string | null
    isDelay: boolean
  }>
}

/**
 * Track and apply a shipment update with full audit trail.
 * 
 * @param db - Drizzle database instance
 * @param shipmentId - The shipment to update
 * @param updates - Object with field updates (uses Drizzle column names, e.g., `etd`, `vesselName`)
 * @param options - Source tracking metadata
 * @returns TrackResult with details of what changed
 */
export async function trackShipmentUpdate(
  db: any,
  shipmentId: string,
  updates: Record<string, any>,
  options: TrackOptions
): Promise<TrackResult> {
  const now = new Date()
  const changes: TrackResult['changes'] = []

  // 1. Read current shipment state
  const current = await db
    .select()
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .get()

  if (!current) {
    throw new Error(`Shipment ${shipmentId} not found`)
  }

  // 2. Diff each tracked field
  for (const [updateKey, historyField] of Object.entries(TRACKED_FIELDS)) {
    if (!(updateKey in updates)) continue

    const oldVal = formatValue(updateKey, current[updateKey])
    const newVal = formatValue(updateKey, updates[updateKey])

    // Skip if no actual change
    if (oldVal === newVal) continue

    // Detect delay: new ETA is later than old ETA
    let isDelay = false
    if (updateKey === 'eta' && oldVal && newVal) {
      const oldDate = new Date(oldVal)
      const newDate = new Date(newVal)
      if (!isNaN(oldDate.getTime()) && !isNaN(newDate.getTime())) {
        isDelay = newDate > oldDate
      }
    }

    changes.push({
      field: historyField,
      oldValue: oldVal,
      newValue: newVal,
      isDelay,
    })

    // Insert history record
    await db.insert(shipmentHistory).values({
      id: crypto.randomUUID(),
      shipmentId,
      field: historyField,
      oldValue: oldVal,
      newValue: newVal,
      sourceType: options.sourceType,
      sourceId: options.sourceId ?? null,
      changedBy: options.changedBy ?? null,
      isDelay,
      notes: options.notes ?? null,
      changedAt: now,
    })
  }

  // 3. Apply the update to the shipment
  if (Object.keys(updates).length > 0) {
    await db
      .update(shipments)
      .set({ ...updates, updatedAt: now })
      .where(eq(shipments.id, shipmentId))
  }

  return {
    fieldsChanged: changes.length,
    delaysDetected: changes.filter((c) => c.isDelay).length,
    changes,
  }
}
