import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ReviewEmailRepository } from '../db/repositories/review-email.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { ShipmentsService } from '../shipments/shipments.service'
import { stateToUiStatus } from '../presentation/adapters/enums'
import type { ReviewEmailDto } from './review-queue.dto'

/**
 * The email-extraction review queue (commit-first). The extracted data was already applied to shipments;
 * high-confidence rows are AUTO_ACCEPTED and never surface here. Low-confidence rows (NEEDS_REVIEW) get a
 * human's after-the-fact verdict: approve (accept the agent's suggestion if any), correct (edit the
 * fields), or reject. Every verdict stamps reviewedBy/At + notes; corrections snapshot the original.
 */
@Injectable()
export class ReviewQueueService {
  private readonly log = new Logger(ReviewQueueService.name)

  constructor(
    private readonly reviewEmails: ReviewEmailRepository,
    private readonly shipments: ShipmentsService,
    private readonly masters: MastersRepository,
  ) {}

  /** Emails in one review state (default: the pending NEEDS_REVIEW tab). The repo returns the linked
   *  shipment FLAT (jobNo/shipmentState); the UI reads a nested `shipment` + isMatched/processingStatus. */
  async queue(status?: string) {
    const rows = await this.reviewEmails.listByStatus(status)
    const emails = rows.map(({ jobNo, shipmentState, ...rest }) => ({
      ...rest,
      isMatched: rest.shipmentId != null,
      processingStatus: 'COMPLETED', // the extraction already ran (commit-first); this gates the human look
      shipment: rest.shipmentId
        ? {
            id: rest.shipmentId,
            status: shipmentState ? stateToUiStatus(shipmentState) : null,
            bookingNo: jobNo ?? null,
            poNumbers: '[]',
            route: null,
          }
        : null,
    }))
    return { emails }
  }

  /** Per-status counts for the filter-tab badges (+ derived total / pending). */
  async counts() {
    const c = await this.reviewEmails.counts()
    const total = c.NEEDS_REVIEW + c.AUTO_ACCEPTED + c.REVIEWED_OK + c.REVIEWED_CORRECTED + c.REJECTED
    return { ...c, total, pending: c.NEEDS_REVIEW }
  }

  /** Record a reviewer's verdict on a queued email. */
  async review(id: string, dto: ReviewEmailDto, actorId: string) {
    const row = await this.reviewEmails.findById(id)
    if (!row) throw new NotFoundException(`review email ${id} not found`)
    const base = { reviewedBy: actorId, reviewedAt: new Date(), reviewNotes: dto.notes ?? null }

    if (dto.action === 'reject') {
      return this.reviewEmails.update(id, { ...base, reviewStatus: 'REJECTED' })
    }

    if (dto.action === 'correct') {
      const corrected = dto.corrections?.extractedData ?? row.extractedData ?? {}
      // apply-back: the correction must reach tracking, not just the review row. Re-apply the corrected
      // fields to the linked shipment via the human-wins edit path (write + field-lock + audit-with-note),
      // so the agent can never re-clobber the human's value and the note feeds soul iteration. Only when the
      // email is matched to a shipment (an unmatched email has nothing to apply onto).
      if (row.shipmentId) await this.shipments.applyExtractionCorrection(row.shipmentId, corrected, actorId, dto.notes)
      // matcher Phase 3 (design decision D): a human raw-name→code correction becomes a prior_correction
      // RETRIEVAL fact — it boosts that code as a candidate next time; the LLM still decides every time.
      await this.recordPriorCorrections(row.extractedData ?? {}, corrected, actorId)
      return this.reviewEmails.update(id, {
        ...base,
        reviewStatus: 'REVIEWED_CORRECTED',
        originalExtractedData: row.originalExtractedData ?? row.extractedData, // snapshot pre-correction once
        extractedData: corrected,
      })
    }

    // approve — accept the agent's suggested changes if present, else keep the extraction as-is
    if (row.suggestedData) {
      return this.reviewEmails.update(id, {
        ...base,
        reviewStatus: 'REVIEWED_OK',
        originalExtractedData: row.originalExtractedData ?? row.extractedData,
        extractedData: row.suggestedData,
      })
    }
    return this.reviewEmails.update(id, { ...base, reviewStatus: 'REVIEWED_OK' })
  }

  /** When a reviewer replaces a RAW party name with a real master code, persist it as a
   *  `prior_correction` fact (lhs = the raw string, rhs = the code). Supersedes any active fact for the
   *  same raw name (latest human word wins). Never throws — a facts hiccup must not sink the verdict. */
  private async recordPriorCorrections(
    original: Record<string, unknown>,
    corrected: Record<string, unknown>,
    actorId: string,
  ): Promise<void> {
    const fields: Array<['customer_code' | 'vendor_code', (code: string) => Promise<unknown>]> = [
      ['customer_code', (c) => this.masters.customerByCode(c)],
      ['vendor_code', (c) => this.masters.vendorIdByCode(c)],
    ]
    for (const [field, lookup] of fields) {
      const oldVal = String(original[field] ?? '').trim()
      const newVal = String(corrected[field] ?? '').trim()
      if (!oldVal || !newVal || oldVal.toUpperCase() === newVal.toUpperCase()) continue
      try {
        // only a raw→code replacement qualifies: the OLD value must NOT be a master code, the NEW must be
        const [oldIsCode, newIsCode] = await Promise.all([lookup(oldVal), lookup(newVal)])
        if (oldIsCode || !newIsCode) continue
        await this.masters.deactivateActiveFor('prior_correction', oldVal)
        await this.masters.insertOpsFact({
          kind: 'prior_correction',
          lhs: oldVal,
          rhs: newVal.toUpperCase(),
          reason: `review correction (${field})`,
          createdBy: actorId,
        })
      } catch (e) {
        this.log.warn(`prior_correction write skipped for ${field} "${oldVal}": ${(e as Error).message}`)
      }
    }
  }
}
