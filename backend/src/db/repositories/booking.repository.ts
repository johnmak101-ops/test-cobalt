import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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
  /** Next job-number sequence = MAX(existing trailing number) + 1, scoped to the JOB-2026-NNNN family so a
   *  foreign-format/legacy booking can't perturb the sequence. Gap-safe, unlike count()+1 which collides the
   *  moment a number is missing (a failed/removed booking leaves a hole). The agent posts sequentially so a
   *  max-based seed is race-free in practice (job_no is UNIQUE, so a concurrent double would fail-fast). */
  async nextJobSeq() {
    const [{ n }] = await this.db
      .select({ n: sql<number>`coalesce(max(substring(job_no from '[0-9]+$')::int), 0)::int` })
      .from(schema.bookings)
      .where(sql`job_no like 'JOB-2026-%'`)
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

  // --- purchase_orders ---
  /** PO master with customer/vendor codes resolved (for the Matcher). When `openOnly`, drops POs
   *  whose linked bookings are all terminal (CLOSED/CANCELLED). */
  async listPos(openOnly = false) {
    const rows = await this.db
      .select({
        id: schema.purchaseOrders.id,
        poNumber: schema.purchaseOrders.poNumber,
        customerCode: schema.customers.code,
        customerName: schema.customers.name,
        vendorCode: schema.vendors.code,
        vendorName: schema.vendors.name,
        brand: schema.purchaseOrders.brand,
        itemStyleNo: schema.purchaseOrders.itemStyleNo,
        totalQuantity: schema.purchaseOrders.totalQuantity,
        quantityUnit: schema.purchaseOrders.quantityUnit,
        crd: schema.purchaseOrders.crd,
        customerId: schema.purchaseOrders.customerId,
        vendorId: schema.purchaseOrders.vendorId,
        notes: schema.purchaseOrders.notes,
        createdAt: schema.purchaseOrders.createdAt,
        updatedAt: schema.purchaseOrders.updatedAt,
      })
      .from(schema.purchaseOrders)
      .leftJoin(schema.customers, eq(schema.purchaseOrders.customerId, schema.customers.id))
      .leftJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
      .orderBy(schema.purchaseOrders.poNumber)

    // shipped qty + how many shipments each PO rides on (the leg-level split)
    const agg = await this.db
      .select({
        poId: schema.shipmentPos.poId,
        shipped: sql<number>`coalesce(sum(${schema.shipmentPos.quantity}), 0)::float`,
        shipments: sql<number>`count(distinct ${schema.shipmentPos.shipmentId})::int`,
      })
      .from(schema.shipmentPos)
      .groupBy(schema.shipmentPos.poId)
    const aggMap = new Map(agg.map((a) => [a.poId, a]))
    const enriched = rows.map((r) => ({
      ...r,
      shippedQuantity: aggMap.get(r.id)?.shipped ?? 0,
      shipmentCount: aggMap.get(r.id)?.shipments ?? 0,
    }))

    if (!openOnly) return enriched
    const closedLinks = await this.db
      .select({ poId: schema.bookingPos.poId })
      .from(schema.bookingPos)
      .innerJoin(schema.bookings, eq(schema.bookingPos.bookingId, schema.bookings.id))
      .where(inArray(schema.bookings.status, ['CLOSED', 'CANCELLED']))
    const closed = new Set(closedLinks.map((r) => r.poId))
    return enriched.filter((r) => !closed.has(r.id))
  }

  /** A single PO with the shipments (legs) it rides on — for the PO detail page. */
  async poDetail(poId: string) {
    const [po] = await this.db
      .select({
        id: schema.purchaseOrders.id,
        poNumber: schema.purchaseOrders.poNumber,
        brand: schema.purchaseOrders.brand,
        itemStyleNo: schema.purchaseOrders.itemStyleNo,
        totalQuantity: schema.purchaseOrders.totalQuantity,
        quantityUnit: schema.purchaseOrders.quantityUnit,
        crd: schema.purchaseOrders.crd,
        customerId: schema.purchaseOrders.customerId,
        vendorId: schema.purchaseOrders.vendorId,
        notes: schema.purchaseOrders.notes,
        customerCode: schema.customers.code,
        customerName: schema.customers.name,
        vendorCode: schema.vendors.code,
        vendorName: schema.vendors.name,
        createdAt: schema.purchaseOrders.createdAt,
        updatedAt: schema.purchaseOrders.updatedAt,
      })
      .from(schema.purchaseOrders)
      .leftJoin(schema.customers, eq(schema.purchaseOrders.customerId, schema.customers.id))
      .leftJoin(schema.vendors, eq(schema.purchaseOrders.vendorId, schema.vendors.id))
      .where(eq(schema.purchaseOrders.id, poId))
    if (!po) return null

    const pol = alias(schema.ports, 'po_pol')
    const pod = alias(schema.ports, 'po_pod')
    const links = await this.db
      .select({
        linkId: schema.shipmentPos.id,
        shipmentId: schema.shipmentPos.shipmentId,
        linkedQuantity: schema.shipmentPos.quantity,
        status: schema.shipments.state,
        bookingNo: schema.shipments.bookingNo,
        hbl: schema.shipments.hblAwbFcrNo,
        so: schema.shipments.soNo,
        etd: schema.shipments.etd,
        eta: schema.shipments.eta,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
        linkedAt: schema.shipmentPos.createdAt,
        containerNo: schema.shipments.containerNo,
        mbl: schema.shipments.mbl,
        scacCode: schema.shipments.scacCode,
        vesselName: schema.shipments.vesselName,
      })
      .from(schema.shipmentPos)
      .innerJoin(schema.shipments, eq(schema.shipmentPos.shipmentId, schema.shipments.id))
      .leftJoin(pol, eq(schema.shipments.polId, pol.id))
      .leftJoin(pod, eq(schema.shipments.podId, pod.id))
      .where(eq(schema.shipmentPos.poId, poId))
    return { po, links }
  }

  /** One batched query: every PO's linked shipments with the fields the PO-list search needs
   *  (container/SCAC/booking#/vessel/HBL/MBL). Grouped by poId in the service. */
  async shipmentSummariesByPo() {
    const pol = alias(schema.ports, 'sum_pol')
    const pod = alias(schema.ports, 'sum_pod')
    return this.db
      .select({
        poId: schema.shipmentPos.poId,
        shipmentId: schema.shipmentPos.shipmentId,
        bookingNo: schema.shipments.bookingNo,
        status: schema.shipments.state,
        containerNo: schema.shipments.containerNo,
        hbl: schema.shipments.hblAwbFcrNo,
        mbl: schema.shipments.mbl,
        scacCode: schema.shipments.scacCode,
        vesselName: schema.shipments.vesselName,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
      })
      .from(schema.shipmentPos)
      .innerJoin(schema.shipments, eq(schema.shipmentPos.shipmentId, schema.shipments.id))
      .leftJoin(pol, eq(schema.shipments.polId, pol.id))
      .leftJoin(pod, eq(schema.shipments.podId, pod.id))
  }

  async upsertPo(poNumber: string, customerId: string | null, vendorId: string | null) {
    const [existing] = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.poNumber, poNumber))
    if (existing) return existing.id
    const [created] = await this.db.insert(schema.purchaseOrders).values({ poNumber, customerId, vendorId }).returning()
    return created.id
  }

  // ---- PO CRUD (app-owned; master refs are validated, never created) ----

  async poById(id: string) {
    const [row] = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id))
    return row ?? null
  }
  async findPoByNumber(poNumber: string) {
    const [row] = await this.db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.poNumber, poNumber))
    return row ?? null
  }
  async createPo(values: typeof schema.purchaseOrders.$inferInsert) {
    const [row] = await this.db.insert(schema.purchaseOrders).values(values).returning()
    return row
  }
  async updatePo(id: string, patch: Record<string, unknown>) {
    const [row] = await this.db
      .update(schema.purchaseOrders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.purchaseOrders.id, id))
      .returning()
    return row ?? null
  }
  /** How many shipment-legs and bookings this PO is linked to (delete-safety + FK RESTRICT). */
  async poLinkCounts(id: string) {
    const [s] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.shipmentPos)
      .where(eq(schema.shipmentPos.poId, id))
    const [b] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bookingPos)
      .where(eq(schema.bookingPos.poId, id))
    return { shipments: s?.n ?? 0, bookings: b?.n ?? 0 }
  }
  async deletePo(id: string) {
    const [row] = await this.db.delete(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)).returning()
    return row ?? null
  }
  async linkShipmentPo(poId: string, shipmentId: string, quantity: number | null, quantityUnit: string | null) {
    const [row] = await this.db
      .insert(schema.shipmentPos)
      .values({ poId, shipmentId, quantity, quantityUnit: quantityUnit as never })
      .onConflictDoNothing()
      .returning()
    return row ?? null
  }
  async unlinkShipmentPo(poId: string, linkId: string) {
    const [row] = await this.db
      .delete(schema.shipmentPos)
      .where(and(eq(schema.shipmentPos.id, linkId), eq(schema.shipmentPos.poId, poId)))
      .returning()
    return row ?? null
  }
}
