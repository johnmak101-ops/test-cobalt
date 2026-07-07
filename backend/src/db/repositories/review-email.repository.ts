import { Inject, Injectable } from '@nestjs/common'
import { asc, desc, eq, sql } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

type ReviewEmailStatus = (typeof schema.reviewEmail.$inferSelect)['reviewStatus']

/**
 * Data access for the email-extraction review queue (tracking.review_email). Reads list/counts for the
 * queue UI and writes the human review-state (approve / correct / reject). The data itself was already
 * applied to shipments (commit-first); this table only gates a human's after-the-fact look.
 */
@Injectable()
export class ReviewEmailRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Emails in one review state (defaults to the pending NEEDS_REVIEW tab), lowest confidence first. */
  listByStatus(status?: string) {
    const want = (status ?? 'NEEDS_REVIEW') as ReviewEmailStatus
    return this.db
      .select({
        id: schema.reviewEmail.id,
        messageId: schema.reviewEmail.messageId,
        graphMessageId: schema.reviewEmail.graphMessageId,
        subject: schema.reviewEmail.subject,
        sender: schema.reviewEmail.sender,
        receivedAt: schema.reviewEmail.receivedAt,
        bodyText: schema.reviewEmail.bodyText,
        emailType: schema.reviewEmail.emailType,
        extractedData: schema.reviewEmail.extractedData,
        originalExtractedData: schema.reviewEmail.originalExtractedData,
        suggestedData: schema.reviewEmail.suggestedData,
        reviewerNotes: schema.reviewEmail.reviewerNotes,
        extractionConfidence: schema.reviewEmail.extractionConfidence,
        shipmentId: schema.reviewEmail.shipmentId,
        reviewStatus: schema.reviewEmail.reviewStatus,
        reviewedBy: schema.reviewEmail.reviewedBy,
        reviewedAt: schema.reviewEmail.reviewedAt,
        reviewNotes: schema.reviewEmail.reviewNotes,
        createdAt: schema.reviewEmail.createdAt,
        // light shipment context for the card chip (null when not linked / not applied)
        jobNo: schema.bookings.jobNo,
        shipmentState: schema.shipments.state,
      })
      .from(schema.reviewEmail)
      .leftJoin(schema.shipments, eq(schema.reviewEmail.shipmentId, schema.shipments.id))
      .leftJoin(schema.bookings, eq(schema.shipments.bookingId, schema.bookings.id))
      .where(eq(schema.reviewEmail.reviewStatus, want))
      .orderBy(asc(schema.reviewEmail.extractionConfidence), desc(schema.reviewEmail.receivedAt))
  }

  /** Counts per review status, for the filter-tab badges. */
  async counts() {
    const rows = await this.db
      .select({ status: schema.reviewEmail.reviewStatus, n: sql<number>`count(*)::int` })
      .from(schema.reviewEmail)
      .groupBy(schema.reviewEmail.reviewStatus)
    const by = new Map(rows.map((r) => [r.status, r.n]))
    return {
      NEEDS_REVIEW: by.get('NEEDS_REVIEW') ?? 0,
      AUTO_ACCEPTED: by.get('AUTO_ACCEPTED') ?? 0,
      REVIEWED_OK: by.get('REVIEWED_OK') ?? 0,
      REVIEWED_CORRECTED: by.get('REVIEWED_CORRECTED') ?? 0,
      REJECTED: by.get('REJECTED') ?? 0,
    }
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(schema.reviewEmail).where(eq(schema.reviewEmail.id, id))
    return row ?? null
  }

  async update(id: string, patch: Partial<typeof schema.reviewEmail.$inferInsert>) {
    const [row] = await this.db
      .update(schema.reviewEmail)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.reviewEmail.id, id))
      .returning()
    return row ?? null
  }
}
