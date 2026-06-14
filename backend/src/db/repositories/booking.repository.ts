import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, sql } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for the Booking aggregate: bookings, booking_pos, purchase_orders. */
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

  // --- purchase_orders ---
  async upsertPo(poNumber: string, customerId: string | null, vendorId: string | null) {
    const [existing] = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.poNumber, poNumber))
    if (existing) return existing.id
    const [created] = await this.db.insert(schema.purchaseOrders).values({ poNumber, customerId, vendorId }).returning()
    return created.id
  }
}
