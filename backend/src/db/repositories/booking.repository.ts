import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { JOB_NO_PREFIX } from '../../common/job-no'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for the Booking aggregate: bookings + booking_pos links. (PO master reads/CRUD and
 *  PO↔shipment links live in PurchaseOrderRepository.) */
@Injectable()
export class BookingRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listOrdered() {
    return this.db.select().from(schema.bookings).orderBy(desc(schema.bookings.createdAt))
  }
  async findById(id: string) {
    const [b] = await this.db.select().from(schema.bookings).where(eq(schema.bookings.id, id))
    return b ?? null
  }
  async create(values: typeof schema.bookings.$inferInsert) {
    const [b] = await this.db.insert(schema.bookings).values(values).returning()
    return b
  }
  update(id: string, patch: Partial<typeof schema.bookings.$inferInsert>) {
    return this.db.update(schema.bookings).set({ ...patch, updatedAt: new Date() }).where(eq(schema.bookings.id, id))
  }
  async count() {
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings)
    return n
  }
  /** Next job-number sequence = MAX(existing trailing number) + 1, scoped to the JOB-2026-NNNN family so a
   *  foreign-format/legacy booking can't perturb the sequence. Gap-safe, unlike count()+1 which collides the
   *  moment a number is missing (a failed/removed booking leaves a hole). The agent posts sequentially so a
   *  max-based seed is race-free in practice (job_no is UNIQUE, so a concurrent double would fail-fast). */
  async nextJobSeq() {
    const [{ n }] = await this.db
      .select({ n: sql<number>`coalesce(max(substring(job_no from '[0-9]+$')::int), 0)::int` })
      .from(schema.bookings)
      .where(sql`job_no like ${JOB_NO_PREFIX + '%'}`)
    return n + 1
  }

  // --- booking_pos ---
  linkPo(bookingId: string, poId: string) {
    return this.db.insert(schema.bookingPos).values({ bookingId, poId }).onConflictDoNothing()
  }
  async posFor(bookingId: string) {
    const links = await this.db.select().from(schema.bookingPos).where(eq(schema.bookingPos.bookingId, bookingId))
    const pos = await Promise.all(
      links.map(async (l) => {
        const [po] = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, l.poId))
        return po
      }),
    )
    return pos.filter(Boolean)
  }
  async poNumbersFor(bookingId: string): Promise<string[]> {
    const rows = await this.db
      .select({ poNumber: schema.purchaseOrders.poNumber })
      .from(schema.bookingPos)
      .innerJoin(schema.purchaseOrders, eq(schema.bookingPos.poId, schema.purchaseOrders.id))
      .where(eq(schema.bookingPos.bookingId, bookingId))
    return rows.map((r) => r.poNumber)
  }

  /** Every given booking's PO numbers in ONE query (bookingId -> [poNumber]) — replaces the per-leg
   *  poNumbersFor N+1 inside the committer's match loop (the dominant ingest cost as shipments grow). */
  async poNumbersByBooking(bookingIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>()
    if (!bookingIds.length) return map
    const rows = await this.db
      .select({ bookingId: schema.bookingPos.bookingId, poNumber: schema.purchaseOrders.poNumber })
      .from(schema.bookingPos)
      .innerJoin(schema.purchaseOrders, eq(schema.bookingPos.poId, schema.purchaseOrders.id))
      .where(inArray(schema.bookingPos.bookingId, bookingIds))
    for (const r of rows) {
      const arr = map.get(r.bookingId)
      if (arr) arr.push(r.poNumber)
      else map.set(r.bookingId, [r.poNumber])
    }
    return map
  }
}
