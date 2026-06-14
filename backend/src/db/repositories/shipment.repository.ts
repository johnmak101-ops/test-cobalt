import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for the Shipment aggregate: shipments, shipment_pos, shipment_milestones. */
@Injectable()
export class ShipmentRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  allLegs() {
    return this.db.select().from(schema.shipments)
  }
  activeLegs() {
    return this.db.select().from(schema.shipments).where(eq(schema.shipments.legStatus, 'ACTIVE'))
  }
  legsForBooking(bookingId: string) {
    return this.db.select().from(schema.shipments).where(eq(schema.shipments.bookingId, bookingId)).orderBy(schema.shipments.legNo)
  }
  async findById(id: string) {
    const [s] = await this.db.select().from(schema.shipments).where(eq(schema.shipments.id, id))
    return s ?? null
  }
  async insertLeg(values: typeof schema.shipments.$inferInsert) {
    const [s] = await this.db.insert(schema.shipments).values(values).returning()
    return s
  }
  updateLeg(id: string, patch: Record<string, unknown>) {
    return this.db.update(schema.shipments).set({ ...patch, updatedAt: new Date() }).where(eq(schema.shipments.id, id))
  }

  // --- shipment_pos ---
  linkPo(shipmentId: string, poId: string, quantity: number | null, unit: string | null) {
    return this.db
      .insert(schema.shipmentPos)
      .values({ shipmentId, poId, quantity, quantityUnit: unit as never })
      .onConflictDoNothing()
  }
  posFor(shipmentId: string) {
    return this.db.select().from(schema.shipmentPos).where(eq(schema.shipmentPos.shipmentId, shipmentId))
  }

  // --- shipment_milestones ---
  milestonesFor(shipmentId: string) {
    return this.db
      .select()
      .from(schema.shipmentMilestones)
      .where(eq(schema.shipmentMilestones.shipmentId, shipmentId))
      .orderBy(schema.shipmentMilestones.occurredAt)
  }
  async replaceMilestones(shipmentId: string, rows: (typeof schema.shipmentMilestones.$inferInsert)[]) {
    await this.db.delete(schema.shipmentMilestones).where(eq(schema.shipmentMilestones.shipmentId, shipmentId))
    if (rows.length) await this.db.insert(schema.shipmentMilestones).values(rows)
  }
}
