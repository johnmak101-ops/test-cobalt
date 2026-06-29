import { Injectable, NotFoundException } from '@nestjs/common'
import { ReviewEmailRepository } from '../db/repositories/review-email.repository'
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
  constructor(private readonly reviewEmails: ReviewEmailRepository) {}

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
      // TODO(apply-back): re-apply corrected fields to row.shipmentId via the committer + field-locks.
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
}
