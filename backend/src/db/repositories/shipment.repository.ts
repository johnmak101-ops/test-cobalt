import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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
  /** Active AND confirmed — provisional (low-confidence) legs are excluded from alerts/automation. */
  activeConfirmedLegs() {
    return this.db
      .select()
      .from(schema.shipments)
      .where(and(eq(schema.shipments.legStatus, 'ACTIVE'), eq(schema.shipments.reviewStatus, 'confirmed')))
  }
  /** Provisional legs awaiting human review (lowest confidence first). */
  provisionalLegs() {
    return this.db
      .select()
      .from(schema.shipments)
      .where(eq(schema.shipments.reviewStatus, 'provisional'))
      .orderBy(schema.shipments.confidence)
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

  /** Active legs enriched with booking + customer + forwarder + route, for the Shipment Tracker list. */
  legsForTracker(status?: string) {
    const pol = alias(schema.ports, 'pol')
    const pod = alias(schema.ports, 'pod')
    const conds = [eq(schema.shipments.legStatus, 'ACTIVE')]
    if (status) conds.push(eq(schema.shipments.state, status as (typeof schema.shipments.$inferSelect)['state']))
    return this.db
      .select({
        id: schema.shipments.id,
        bookingId: schema.shipments.bookingId,
        jobNo: schema.bookings.jobNo,
        bookingNo: schema.shipments.bookingNo,
        soNo: schema.shipments.soNo,
        hblAwbFcrNo: schema.shipments.hblAwbFcrNo,
        mbl: schema.shipments.mbl,
        containerNo: schema.shipments.containerNo,
        mode: schema.shipments.mode,
        status: schema.shipments.state,
        riskLevel: schema.shipments.riskLevel,
        reviewStatus: schema.shipments.reviewStatus,
        confidence: schema.shipments.confidence,
        etd: schema.shipments.etd,
        eta: schema.shipments.eta,
        updatedAt: schema.shipments.updatedAt,
        customerId: schema.customers.id,
        customerName: schema.customers.name,
        customerCode: schema.customers.code,
        forwarderId: schema.forwarders.id,
        forwarderName: schema.forwarders.name,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
      })
      .from(schema.shipments)
      .innerJoin(schema.bookings, eq(schema.shipments.bookingId, schema.bookings.id))
      .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
      .leftJoin(schema.forwarders, eq(schema.shipments.forwarderId, schema.forwarders.id))
      .leftJoin(pol, eq(schema.shipments.polId, pol.id))
      .leftJoin(pod, eq(schema.shipments.podId, pod.id))
      .where(and(...conds))
      .orderBy(desc(schema.shipments.updatedAt))
  }

  /** One leg enriched like the tracker list (customer / forwarder / route) — any legStatus, for the detail page. */
  async legDetailById(id: string) {
    const pol = alias(schema.ports, 'pol')
    const pod = alias(schema.ports, 'pod')
    const [row] = await this.db
      .select({
        id: schema.shipments.id,
        bookingId: schema.shipments.bookingId,
        jobNo: schema.bookings.jobNo,
        bookingNo: schema.shipments.bookingNo,
        soNo: schema.shipments.soNo,
        hblAwbFcrNo: schema.shipments.hblAwbFcrNo,
        mbl: schema.shipments.mbl,
        containerNo: schema.shipments.containerNo,
        mode: schema.shipments.mode,
        state: schema.shipments.state,
        legStatus: schema.shipments.legStatus,
        riskLevel: schema.shipments.riskLevel,
        reviewStatus: schema.shipments.reviewStatus,
        confidence: schema.shipments.confidence,
        reviewReasons: schema.shipments.reviewReasons,
        etd: schema.shipments.etd,
        atd: schema.shipments.atd,
        eta: schema.shipments.eta,
        updatedAt: schema.shipments.updatedAt,
        customerId: schema.customers.id,
        customerName: schema.customers.name,
        customerCode: schema.customers.code,
        forwarderId: schema.forwarders.id,
        forwarderName: schema.forwarders.name,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
      })
      .from(schema.shipments)
      .innerJoin(schema.bookings, eq(schema.shipments.bookingId, schema.bookings.id))
      .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
      .leftJoin(schema.forwarders, eq(schema.shipments.forwarderId, schema.forwarders.id))
      .leftJoin(pol, eq(schema.shipments.polId, pol.id))
      .leftJoin(pod, eq(schema.shipments.podId, pod.id))
      .where(eq(schema.shipments.id, id))
    return row ?? null
  }

  /** A booking's POs (number + vendor + qty) — the expandable child rows on a shipment. */
  linkedPosForBooking(bookingId: string) {
    return this.db
      .select({
        id: schema.purchaseOrders.id,
        poNumber: schema.purchaseOrders.poNumber,
        totalQuantity: schema.purchaseOrders.totalQuantity,
        quantityUnit: schema.purchaseOrders.quantityUnit,
        vendorName: schema.vendors.name,
      })
      .from(schema.bookingPos)
      .innerJoin(schema.purchaseOrders, eq(schema.bookingPos.poId, schema.purchaseOrders.id))
      .leftJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
      .where(eq(schema.bookingPos.bookingId, bookingId))
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
