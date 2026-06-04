import { eq, like, or } from 'drizzle-orm'
import { shipments, customers, forwarders } from '../db/schema.js'
import type { ExtractedData } from './extractor.js'

/**
 * Step 3: VALIDATE & MATCH — Validate extracted data and match to shipments.
 * - Checks PO# formats
 * - Validates date sanity (ETA after ETD)
 * - Matches PO numbers to existing shipment records
 * - Resolves customer/forwarder names to IDs
 * - Computes confidence penalties for the review queue
 */

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

export interface MatchResult {
  shipmentId: string | null
  customerId: string | null
  forwarderId: string | null
  isMatched: boolean
  matchMethod: string | null
  /** Confidence penalty to apply (0.0 to ~0.75, subtracted from extraction confidence) */
  confidencePenalty: number
  penaltyReasons: string[]
}

/**
 * Validate the extracted data for sanity.
 */
export function validateExtractedData(data: ExtractedData): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check PO numbers exist
  if (!data.po_numbers || data.po_numbers.length === 0) {
    warnings.push('No PO numbers extracted')
  }

  // Validate PO number formats (basic sanity)
  for (const po of data.po_numbers ?? []) {
    if (po.length < 3) {
      warnings.push(`PO number "${po}" seems too short`)
    }
    if (po.length > 30) {
      warnings.push(`PO number "${po}" seems too long`)
    }
  }

  // Validate date sanity
  if (data.etd && data.eta) {
    const etd = new Date(data.etd)
    const eta = new Date(data.eta)
    if (!isNaN(etd.getTime()) && !isNaN(eta.getTime()) && eta < etd) {
      errors.push(`ETA (${data.eta}) is before ETD (${data.etd})`)
    }
  }

  // Validate date formats
  const dateFields = ['crd', 'cfs_cutoff', 'etd', 'eta'] as const
  for (const field of dateFields) {
    const val = data[field]
    if (val !== null && isNaN(new Date(val).getTime())) {
      errors.push(`Invalid date format for ${field}: "${val}"`)
    }
  }

  // Validate HBL format (should be alphanumeric, 8-20 chars)
  if (data.hbl_number && !/^[A-Z0-9]{6,20}$/i.test(data.hbl_number)) {
    warnings.push(`HBL number "${data.hbl_number}" has unexpected format`)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Match extracted PO numbers against existing shipments in the database.
 * Also resolves customer and forwarder names to IDs.
 * Computes confidence penalties for the review queue system.
 */
export async function matchToShipment(
  db: any,
  data: ExtractedData
): Promise<MatchResult> {
  let shipmentId: string | null = null
  let customerId: string | null = null
  let forwarderId: string | null = null
  let matchMethod: string | null = null

  // Confidence penalty tracking
  let confidencePenalty = 0
  const penaltyReasons: string[] = []

  // Try to match by PO numbers
  if (data.po_numbers && data.po_numbers.length > 0) {
    const allShipments = await db.select().from(shipments)

    for (const shipment of allShipments) {
      let shipmentPOs: string[]
      try {
        shipmentPOs = JSON.parse(shipment.poNumbers)
      } catch {
        continue
      }

      // Check if any extracted PO matches any shipment PO
      for (const extractedPO of data.po_numbers) {
        for (const shipmentPO of shipmentPOs) {
          if (
            extractedPO === shipmentPO ||
            extractedPO.includes(shipmentPO) ||
            shipmentPO.includes(extractedPO)
          ) {
            shipmentId = shipment.id
            matchMethod = `PO match: ${extractedPO} ↔ ${shipmentPO}`
            break
          }
        }
        if (shipmentId) break
      }
      if (shipmentId) break
    }

    // Penalty: PO numbers found but no shipment match
    if (!shipmentId) {
      confidencePenalty += 0.2
      penaltyReasons.push('PO# not found in existing shipments')
    }

    // Penalty: Multiple PO candidates (ambiguous)
    if (data.po_numbers.length > 3) {
      confidencePenalty += 0.15
      penaltyReasons.push(`Multiple PO# candidates found (${data.po_numbers.length})`)
    }
  } else {
    // No PO numbers at all
    confidencePenalty += 0.2
    penaltyReasons.push('No PO numbers extracted')
  }

  // Try to match by HBL number if no PO match
  if (!shipmentId && data.hbl_number) {
    const match = await db
      .select()
      .from(shipments)
      .where(eq(shipments.hblNumber, data.hbl_number))
      .get()

    if (match) {
      shipmentId = match.id
      matchMethod = `HBL match: ${data.hbl_number}`
    }
  }

  // Penalty: Missing key fields (ETD and HBL)
  if (!data.etd && !data.hbl_number) {
    confidencePenalty += 0.1
    penaltyReasons.push('Missing key fields (ETD, HBL#)')
  }

  // Resolve customer name to ID
  if (data.customer) {
    const customerName = data.customer
    const customer = await db
      .select()
      .from(customers)
      .where(
        or(
          eq(customers.name, customerName),
          eq(customers.code, customerName),
          like(customers.name, `%${customerName}%`)
        )
      )
      .get()

    if (customer) {
      customerId = customer.id
    }
  }

  // Resolve forwarder name to ID
  if (data.forwarder) {
    const forwarderName = data.forwarder
    const forwarder = await db
      .select()
      .from(forwarders)
      .where(
        or(
          eq(forwarders.name, forwarderName),
          like(forwarders.name, `%${forwarderName}%`)
        )
      )
      .get()

    if (forwarder) {
      forwarderId = forwarder.id
    } else {
      // Penalty: Forwarder not recognized in our system
      confidencePenalty += 0.1
      penaltyReasons.push(`Forwarder "${data.forwarder}" not recognized`)
    }
  }

  return {
    shipmentId,
    customerId,
    forwarderId,
    isMatched: shipmentId !== null,
    matchMethod,
    confidencePenalty: Math.min(confidencePenalty, 0.75), // Cap total penalty
    penaltyReasons,
  }
}
