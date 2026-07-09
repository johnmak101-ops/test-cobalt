import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Update patch for a review_email row (the human review-state write). JSON fields take the parsed object
 *  shape (like the Drizzle `$inferInsert` did) — `update()` stringifies them for the nvarchar column. */
export type ReviewEmailPatch = Partial<{
  reviewStatus: string
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNotes: string | null
  reviewerNotes: string | null
  suggestedData: Record<string, unknown> | null
  extractedData: Record<string, unknown> | null
  originalExtractedData: Record<string, unknown> | null
}>

/** Kysely/SQL Server port of ReviewEmailRepository. Email-extraction review queue (tracking.review_email):
 *  reads for the queue UI + writes the human review-state (approve / correct / reject). The data itself
 *  was already applied to shipments (commit-first); this table only gates a human's after-the-fact look.
 *
 *  Postgres → MSSQL notes:
 *  - `returning` → `OUTPUT` (`.outputAll`).
 *  - `count(*)::int` → `count(*)` cast to number client-side (the codegen types it as string).
 *  - The extracted_data / suggested_data columns are nvarchar(max) JSON in SQL Server: parsed to objects on
 *    read (ParseJSONResultsPlugin), stringified here on write — callers see objects, like with Drizzle jsonb. */
@Injectable()
export class ReviewEmailRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /** Emails in one review state (defaults to the pending NEEDS_REVIEW tab), lowest confidence first. */
  listByStatus(status?: string) {
    const want = status ?? 'NEEDS_REVIEW'
    return this.db
      .selectFrom('reviewEmail')
      .leftJoin('shipments', 'reviewEmail.shipmentId', 'shipments.id')
      .leftJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .where('reviewEmail.reviewStatus', '=', want)
      .orderBy('reviewEmail.extractionConfidence', 'asc')
      .orderBy('reviewEmail.receivedAt', 'desc')
      .select([
        'reviewEmail.id as id', 'reviewEmail.messageId as messageId', 'reviewEmail.graphMessageId as graphMessageId',
        'reviewEmail.subject as subject', 'reviewEmail.sender as sender', 'reviewEmail.receivedAt as receivedAt',
        'reviewEmail.bodyText as bodyText', 'reviewEmail.emailType as emailType',
        'reviewEmail.extractedData as extractedData', 'reviewEmail.originalExtractedData as originalExtractedData',
        'reviewEmail.suggestedData as suggestedData', 'reviewEmail.reviewerNotes as reviewerNotes',
        'reviewEmail.extractionConfidence as extractionConfidence', 'reviewEmail.shipmentId as shipmentId',
        'reviewEmail.reviewStatus as reviewStatus', 'reviewEmail.reviewedBy as reviewedBy',
        'reviewEmail.reviewedAt as reviewedAt', 'reviewEmail.reviewNotes as reviewNotes',
        'reviewEmail.createdAt as createdAt',
        // light shipment context for the card chip (null when not linked / not applied)
        'bookings.jobNo as jobNo', 'shipments.state as shipmentState',
      ])
      .execute()
  }

  /** Counts per review status, for the filter-tab badges. */
  async counts() {
    const rows = await this.db
      .selectFrom('reviewEmail')
      .select(['reviewStatus', this.db.fn.count<number>('id').as('n')])
      .groupBy('reviewStatus')
      .execute()
    const by = new Map(rows.map((r) => [r.reviewStatus, Number(r.n)]))
    return {
      NEEDS_REVIEW: by.get('NEEDS_REVIEW') ?? 0,
      AUTO_ACCEPTED: by.get('AUTO_ACCEPTED') ?? 0,
      REVIEWED_OK: by.get('REVIEWED_OK') ?? 0,
      REVIEWED_CORRECTED: by.get('REVIEWED_CORRECTED') ?? 0,
      REJECTED: by.get('REJECTED') ?? 0,
    }
  }

  async findById(id: string) {
    const row = await this.db.selectFrom('reviewEmail').where('id', '=', id).selectAll().executeTakeFirst()
    return row ?? null
  }

  async update(id: string, patch: ReviewEmailPatch) {
    // JSON nvarchar(max) columns are written as strings; undefined keys are dropped by Kysely's .set().
    const json = (v: Record<string, unknown> | null | undefined) =>
      v === undefined ? undefined : v === null ? null : JSON.stringify(v)
    const row = await this.db
      .updateTable('reviewEmail')
      .set({
        ...patch,
        suggestedData: json(patch.suggestedData),
        extractedData: json(patch.extractedData),
        originalExtractedData: json(patch.originalExtractedData),
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }
}
