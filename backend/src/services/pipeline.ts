import { eq } from 'drizzle-orm'
import crypto from 'node:crypto'
import { shippingEmails, shipments, shipmentMilestones } from '../db/schema.js'
import type { EmailType, MilestoneType, ShipmentStatus, ReviewStatus } from '../types/index.js'
import { classifyEmail } from './classifier.js'
import {
  extractEmailData,
  extractEmailDataFallback,
  type ExtractedData,
} from './extractor.js'
import { validateExtractedData, matchToShipment } from './matcher.js'
import { evaluateAlertsForShipment } from './alert-evaluator.js'
import { trackShipmentUpdate } from './history.js'

/**
 * Pipeline Orchestrator — coordinates the 4-step email processing pipeline:
 * 1. CLASSIFY (keyword matching)
 * 2. EXTRACT (Claude AI or regex fallback)
 * 3. VALIDATE & MATCH (PO matching, date sanity, confidence penalties)
 * 4. STORE & ALERT (update shipment with audit trail, create milestone, evaluate alerts)
 *
 * Review status thresholds:
 *   > 0.9  → AUTO_ACCEPTED  (auto-linked to shipment)
 *   0.7–0.9 → FLAGGED       (accepted but flagged for review)
 *   0.5–0.7 → NEEDS_REVIEW  (queued, NOT auto-linked)
 *   < 0.5  → REJECTED       (not a shipping email / too uncertain)
 *
 * Target: < 30 seconds from email arrival to dashboard update.
 */

// Maps email type to the milestone it represents
const EMAIL_TYPE_TO_MILESTONE: Partial<Record<EmailType, MilestoneType>> = {
  BOOKING_REQUEST: 'BOOKING_SENT',
  SHIPPING_ORDER: 'SO_RECEIVED',
  DRAFT_BL: 'DRAFT_BL_RECEIVED',
  FINAL_BL: 'FINAL_BL_RECEIVED',
  TELEX_RELEASE: 'TELEX_RELEASED',
}

// Maps email type to the shipment status it transitions to
const EMAIL_TYPE_TO_STATUS: Partial<Record<EmailType, ShipmentStatus>> = {
  SHIPPING_ORDER: 'CONFIRMED',
  DRAFT_BL: 'AT_WAREHOUSE',
  FINAL_BL: 'SAILED',
  TELEX_RELEASE: 'RELEASED',
}

// Review status thresholds
const REVIEW_THRESHOLDS = {
  autoAccept: 0.9,
  flag: 0.7,
  needsReview: 0.5,
}

export interface PipelineResult {
  emailId: string
  emailType: EmailType
  classificationConfidence: number
  extractedData: ExtractedData | null
  extractionConfidence: number
  finalConfidence: number
  reviewStatus: ReviewStatus
  shipmentId: string | null
  isMatched: boolean
  milestoneCreated: boolean
  shipmentUpdated: boolean
  alertsCreated: number
  alertsResolved: number
  historyEntriesCreated: number
  delaysDetected: number
  errors: string[]
  warnings: string[]
  penaltyReasons: string[]
  processingTimeMs: number
}

interface ProcessEmailInput {
  subject: string
  sender: string
  bodyText: string
  bodyHtml?: string
  receivedAt: Date
  messageId?: string
}

/**
 * Determine review status based on final confidence score.
 */
function determineReviewStatus(confidence: number, emailType: EmailType): ReviewStatus {
  if (emailType === 'OTHER') return 'REJECTED'
  if (confidence >= REVIEW_THRESHOLDS.autoAccept) return 'AUTO_ACCEPTED'
  if (confidence >= REVIEW_THRESHOLDS.flag) return 'FLAGGED'
  if (confidence >= REVIEW_THRESHOLDS.needsReview) return 'NEEDS_REVIEW'
  return 'REJECTED'
}

/**
 * Process a single email through the full pipeline.
 */
export async function processEmail(
  db: any,
  input: ProcessEmailInput,
  options?: { useAI?: boolean }
): Promise<PipelineResult> {
  const startTime = Date.now()
  const useAI = options?.useAI ?? !!process.env.ANTHROPIC_API_KEY
  const errors: string[] = []
  const warnings: string[] = []
  const emailId = crypto.randomUUID()

  // ============================================
  // Step 1: CLASSIFY
  // ============================================
  const classification = classifyEmail(input.subject, input.bodyText)

  // ============================================
  // Step 2: EXTRACT
  // ============================================
  let extractedData: ExtractedData | null = null
  let extractionConfidence = 0

  if (classification.emailType !== 'OTHER') {
    if (useAI) {
      try {
        const extraction = await extractEmailData(
          input.subject,
          input.bodyText,
          classification.emailType
        )
        extractedData = extraction.data
        extractionConfidence = extraction.confidence

        if (extraction.confidence === 0) {
          warnings.push('AI extraction returned zero confidence — using fallback')
          extractedData = extractEmailDataFallback(input.subject, input.bodyText)
          extractionConfidence = 0.3
        }
      } catch (err) {
        warnings.push(`AI extraction failed: ${err instanceof Error ? err.message : String(err)}`)
        extractedData = extractEmailDataFallback(input.subject, input.bodyText)
        extractionConfidence = 0.3
      }
    } else {
      extractedData = extractEmailDataFallback(input.subject, input.bodyText)
      extractionConfidence = 0.3
    }
  }

  // ============================================
  // Step 3: VALIDATE & MATCH
  // ============================================
  let shipmentId: string | null = null
  let isMatched = false
  let confidencePenalty = 0
  let penaltyReasons: string[] = []

  if (extractedData) {
    const validation = validateExtractedData(extractedData)
    errors.push(...validation.errors)
    warnings.push(...validation.warnings)

    const match = await matchToShipment(db, extractedData)
    shipmentId = match.shipmentId
    isMatched = match.isMatched
    confidencePenalty = match.confidencePenalty
    penaltyReasons = match.penaltyReasons

    if (match.matchMethod) {
      warnings.push(`Match: ${match.matchMethod}`)
    }
    if (penaltyReasons.length > 0) {
      warnings.push(`Confidence penalties: ${penaltyReasons.join(', ')}`)
    }
  }

  // Compute final confidence (extraction confidence minus match penalties)
  const combinedConfidence = Math.round(
    ((classification.confidence + extractionConfidence) / 2) * 100
  ) / 100
  const finalConfidence = Math.max(0, Math.round((combinedConfidence - confidencePenalty) * 100) / 100)

  // Determine review status
  const reviewStatus = determineReviewStatus(finalConfidence, classification.emailType)

  // For NEEDS_REVIEW and REJECTED, do NOT auto-link to shipment
  const shouldAutoLink = reviewStatus === 'AUTO_ACCEPTED' || reviewStatus === 'FLAGGED'

  // ============================================
  // Step 4: STORE & ALERT
  // ============================================

  // 4a. Store the email record
  await db.insert(shippingEmails).values({
    id: emailId,
    messageId: input.messageId ?? null,
    subject: input.subject,
    sender: input.sender,
    receivedAt: input.receivedAt,
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml ?? null,
    emailType: classification.emailType,
    extractedData: extractedData ? JSON.stringify(extractedData) : null,
    extractionConfidence: finalConfidence,
    shipmentId: shouldAutoLink ? shipmentId : null,
    isMatched: shouldAutoLink ? isMatched : false,
    processingStatus: errors.length > 0 ? 'FAILED' : 'COMPLETED',
    reviewStatus,
  })

  // 4b. Update shipment if matched AND auto-accepted/flagged
  let milestoneCreated = false
  let shipmentUpdated = false
  let alertsCreated = 0
  let alertsResolved = 0
  let historyEntriesCreated = 0
  let delaysDetected = 0

  if (shipmentId && shouldAutoLink && extractedData) {
    // Build updates from extracted data
    const updates: Record<string, any> = {}

    if (extractedData.hbl_number) updates.hblNumber = extractedData.hbl_number
    if (extractedData.vessel) updates.vesselName = extractedData.vessel
    if (extractedData.voyage_number) updates.voyageNumber = extractedData.voyage_number
    if (extractedData.etd) updates.etd = new Date(extractedData.etd)
    if (extractedData.eta) updates.eta = new Date(extractedData.eta)
    if (extractedData.cfs_cutoff) updates.cfsCutoff = new Date(extractedData.cfs_cutoff)
    if (extractedData.warehouse_address) updates.warehouseAddress = extractedData.warehouse_address
    if (extractedData.quantity != null) updates.quantityShipped = extractedData.quantity
    if (extractedData.quantity_unit) updates.quantityUnit = extractedData.quantity_unit

    // Transition shipment status based on email type
    const newStatus = EMAIL_TYPE_TO_STATUS[classification.emailType]
    if (newStatus) {
      const currentShipment = await db
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .get()

      // Only advance status forward (never go backward)
      if (currentShipment && shouldAdvanceStatus(currentShipment.status, newStatus)) {
        updates.status = newStatus
      }
    }

    // Apply updates with audit trail via trackShipmentUpdate
    if (Object.keys(updates).length > 0) {
      const trackResult = await trackShipmentUpdate(db, shipmentId, updates, {
        sourceType: 'email',
        sourceId: emailId,
        notes: `From email: ${input.subject.slice(0, 100)}`,
      })
      shipmentUpdated = trackResult.fieldsChanged > 0
      historyEntriesCreated = trackResult.fieldsChanged
      delaysDetected = trackResult.delaysDetected
    }

    // Create milestone if applicable
    const milestoneType = EMAIL_TYPE_TO_MILESTONE[classification.emailType]
    if (milestoneType) {
      // Check milestone doesn't already exist
      const existingMilestones = await db
        .select()
        .from(shipmentMilestones)
        .where(eq(shipmentMilestones.shipmentId, shipmentId))

      const alreadyExists = existingMilestones.some(
        (m: any) => m.milestoneType === milestoneType
      )

      if (!alreadyExists) {
        await db.insert(shipmentMilestones).values({
          id: crypto.randomUUID(),
          shipmentId,
          milestoneType,
          occurredAt: input.receivedAt,
          emailId,
          notes: `Auto-created from email: ${input.subject.slice(0, 100)}`,
        })
        milestoneCreated = true
      }
    }

    // Evaluate alerts for this shipment
    const alertResult = await evaluateAlertsForShipment(db, shipmentId)
    alertsCreated = alertResult.created
    alertsResolved = alertResult.resolved
  }

  const processingTimeMs = Date.now() - startTime

  return {
    emailId,
    emailType: classification.emailType,
    classificationConfidence: classification.confidence,
    extractedData,
    extractionConfidence,
    finalConfidence,
    reviewStatus,
    shipmentId: shouldAutoLink ? shipmentId : null,
    isMatched: shouldAutoLink ? isMatched : false,
    milestoneCreated,
    shipmentUpdated,
    alertsCreated,
    alertsResolved,
    historyEntriesCreated,
    delaysDetected,
    errors,
    warnings,
    penaltyReasons,
    processingTimeMs,
  }
}

// Status order for determining if we should advance
const STATUS_ORDER: ShipmentStatus[] = [
  'BOOKED',
  'CONFIRMED',
  'AT_WAREHOUSE',
  'SAILED',
  'RELEASED',
  'DELIVERED',
]

function shouldAdvanceStatus(
  current: string,
  next: ShipmentStatus
): boolean {
  const currentIdx = STATUS_ORDER.indexOf(current as ShipmentStatus)
  const nextIdx = STATUS_ORDER.indexOf(next)
  return nextIdx > currentIdx
}
