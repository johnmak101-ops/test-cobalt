import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
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
  /** Legs for the tracker/dashboard: ACTIVE plus CANCELLED (so a cancelled booking still surfaces, shown as
   *  Cancelled). Only SUPERSEDED legs are hidden. */
  activeLegs() {
    return this.db.select().from(schema.shipments).where(inArray(schema.shipments.legStatus, ['ACTIVE', 'CANCELLED']))
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
  /**
   * The shipment-based Review Queue: provisional (low-confidence) real shipments awaiting human
   * approval — kind='SHIPMENT', review_status='provisional', not SUPERSEDED. Enriched with booking
   * customer / forwarder / route / po-count, mirroring the tracker list joins. Lowest confidence first.
   */
  reviewQueue() {
    const pol = alias(schema.ports, 'pol')
    const pod = alias(schema.ports, 'pod')
    return this.db
      .select({
        id: schema.shipments.id,
        bookingNo: schema.shipments.bookingNo,
        soNo: schema.shipments.soNo,
        state: schema.shipments.state,
        legStatus: schema.shipments.legStatus,
        reviewReasons: schema.shipments.reviewReasons,
        confidence: schema.shipments.confidence,
        createdAt: schema.shipments.createdAt,
        customerId: schema.customers.id,
        customerName: schema.customers.name,
        customerCode: schema.customers.code,
        forwarderId: schema.forwarders.id,
        forwarderName: schema.forwarders.name,
        forwarderRaw: schema.shipments.forwarderRaw,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
        polRaw: schema.shipments.polRaw,
        podRaw: schema.shipments.podRaw,
        poCount: sql<number>`(
          select count(*)::int
          from tracking.booking_pos bp
          where bp.booking_id = ${schema.shipments.bookingId}
        )`,
      })
      .from(schema.shipments)
      .innerJoin(schema.bookings, eq(schema.shipments.bookingId, schema.bookings.id))
      .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
      .leftJoin(schema.forwarders, eq(schema.shipments.forwarderId, schema.forwarders.id))
      .leftJoin(pol, eq(schema.shipments.polId, pol.id))
      .leftJoin(pod, eq(schema.shipments.podId, pod.id))
      .where(
        and(
          eq(schema.shipments.kind, 'SHIPMENT'),
          eq(schema.shipments.reviewStatus, 'provisional'),
          sql`${schema.shipments.legStatus} <> 'SUPERSEDED'`,
        ),
      )
      .orderBy(schema.shipments.confidence, desc(schema.shipments.createdAt))
  }

  /** Count of provisional shipments awaiting review — the nav badge. */
  async reviewQueueCount(): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.shipments)
      .where(
        and(
          eq(schema.shipments.kind, 'SHIPMENT'),
          eq(schema.shipments.reviewStatus, 'provisional'),
          sql`${schema.shipments.legStatus} <> 'SUPERSEDED'`,
        ),
      )
    return r?.n ?? 0
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
        forwarderRaw: schema.shipments.forwarderRaw,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
        polRaw: schema.shipments.polRaw,
        podRaw: schema.shipments.podRaw,
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
        forwarderRaw: schema.shipments.forwarderRaw,
        polCode: pol.unlocode,
        podCode: pod.unlocode,
        polRaw: schema.shipments.polRaw,
        podRaw: schema.shipments.podRaw,
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

  /** Every source email that contributed to this shipment (the Related Emails list). */
  async replaceEmails(shipmentId: string, rows: (typeof schema.shipmentEmails.$inferInsert)[]) {
    await this.db.delete(schema.shipmentEmails).where(eq(schema.shipmentEmails.shipmentId, shipmentId))
    if (rows.length) await this.db.insert(schema.shipmentEmails).values(rows).onConflictDoNothing()
  }

  // --- shipment_identifiers (every value each identity field ever held — current first) ---
  identifiersFor(shipmentId: string) {
    return this.db
      .select()
      .from(schema.shipmentIdentifiers)
      .where(eq(schema.shipmentIdentifiers.shipmentId, shipmentId))
      .orderBy(desc(schema.shipmentIdentifiers.isCurrent), desc(schema.shipmentIdentifiers.rank))
  }
  async replaceIdentifiers(shipmentId: string, rows: (typeof schema.shipmentIdentifiers.$inferInsert)[]) {
    await this.db.delete(schema.shipmentIdentifiers).where(eq(schema.shipmentIdentifiers.shipmentId, shipmentId))
    if (rows.length) await this.db.insert(schema.shipmentIdentifiers).values(rows)
  }

  // --- shipment_parties (co-valid customer entities with roles — the primary first) ---
  partiesFor(shipmentId: string) {
    return this.db
      .select()
      .from(schema.shipmentParties)
      .where(eq(schema.shipmentParties.shipmentId, shipmentId))
      .orderBy(desc(schema.shipmentParties.isPrimary), desc(schema.shipmentParties.rank))
  }
  async replaceParties(shipmentId: string, rows: (typeof schema.shipmentParties.$inferInsert)[]) {
    await this.db.delete(schema.shipmentParties).where(eq(schema.shipmentParties.shipmentId, shipmentId))
    if (rows.length) await this.db.insert(schema.shipmentParties).values(rows)
  }

  // --- documents (kind='DOCUMENT' orphan legs — the Unlinked Documents view) ---

  /**
   * Unlinked documents: kind='DOCUMENT' legs not yet linked onto a real shipment. Each row is enriched
   * with the booking's customer name, its distinct email type(s), a best-effort sender type (joined from
   * evidence.parsed_record on graph_message_id), the PO numbers it carries, and the newest received-at.
   * Ordered newest-first (nulls last). Single query; the per-row lists are aggregated in Postgres.
   */
  async documents() {
    const rows = await this.db
      .select({
        id: schema.shipments.id,
        customerName: schema.customers.name,
        qty: schema.shipments.qty,
        qtyUnit: schema.shipments.qtyUnit,
        emailType: sql<string | null>`(
          select string_agg(distinct se.email_type, ', ')
          from tracking.shipment_emails se
          where se.shipment_id = ${schema.shipments.id} and se.email_type is not null
        )`,
        senderType: sql<string | null>`(
          select pr.sender_type
          from tracking.shipment_emails se
          join evidence.parsed_record pr on pr.graph_message_id = se.graph_message_id
          where se.shipment_id = ${schema.shipments.id} and pr.sender_type is not null
          limit 1
        )`,
        poNumbers: sql<string[]>`coalesce((
          select array_agg(po.po_number order by po.po_number)
          from tracking.shipment_pos sp
          join tracking.purchase_orders po on po.id = sp.po_id
          where sp.shipment_id = ${schema.shipments.id}
        ), '{}')`,
        receivedAt: sql<Date | null>`(
          select max(se.received_at)
          from tracking.shipment_emails se
          where se.shipment_id = ${schema.shipments.id}
        )`,
      })
      .from(schema.shipments)
      .leftJoin(schema.bookings, eq(schema.shipments.bookingId, schema.bookings.id))
      .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
      .where(and(eq(schema.shipments.kind, 'DOCUMENT'), isNull(schema.shipments.linkedShipmentId), isNull(schema.shipments.dismissedAt)))
      .orderBy(sql`(
        select max(se.received_at)
        from tracking.shipment_emails se
        where se.shipment_id = ${schema.shipments.id}
      ) desc nulls last`)
    return rows
  }

  /**
   * One unlinked document's detail (the detail panel): booking customer + email type(s) + sender type +
   * PO numbers + qty + newest received-at, plus the queue_message id of its most-recent source email
   * (joined shipment_emails.graph_message_id → queue_message.graph_message_id) so the UI can open the
   * source email pop-up. Null when the id isn't a document.
   */
  async documentDetail(id: string) {
    const [row] = await this.db
      .select({
        id: schema.shipments.id,
        customerName: schema.customers.name,
        qty: schema.shipments.qty,
        qtyUnit: schema.shipments.qtyUnit,
        emailType: sql<string | null>`(
          select string_agg(distinct se.email_type, ', ')
          from tracking.shipment_emails se
          where se.shipment_id = ${schema.shipments.id} and se.email_type is not null
        )`,
        senderType: sql<string | null>`(
          select pr.sender_type
          from tracking.shipment_emails se
          join evidence.parsed_record pr on pr.graph_message_id = se.graph_message_id
          where se.shipment_id = ${schema.shipments.id} and pr.sender_type is not null
          limit 1
        )`,
        poNumbers: sql<string[]>`coalesce((
          select array_agg(po.po_number order by po.po_number)
          from tracking.shipment_pos sp
          join tracking.purchase_orders po on po.id = sp.po_id
          where sp.shipment_id = ${schema.shipments.id}
        ), '{}')`,
        receivedAt: sql<Date | null>`(
          select max(se.received_at)
          from tracking.shipment_emails se
          where se.shipment_id = ${schema.shipments.id}
        )`,
        // queue_message id of the newest source email (for the /email/:emailId pop-up)
        emailId: sql<string | null>`(
          select qm.id
          from tracking.shipment_emails se
          join queue.queue_message qm on qm.graph_message_id = se.graph_message_id
          where se.shipment_id = ${schema.shipments.id}
          order by se.received_at desc nulls last
          limit 1
        )`,
      })
      .from(schema.shipments)
      .leftJoin(schema.bookings, eq(schema.shipments.bookingId, schema.bookings.id))
      .leftJoin(schema.customers, eq(schema.bookings.customerId, schema.customers.id))
      .where(and(eq(schema.shipments.id, id), eq(schema.shipments.kind, 'DOCUMENT')))
    return row ?? null
  }

  /** Mark an unlinked document dismissed (idempotent) — it drops off the Unlinked Documents list. */
  dismissDocument(id: string) {
    return this.db
      .update(schema.shipments)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.shipments.id, id), eq(schema.shipments.kind, 'DOCUMENT')))
  }

  /** kind lookup for a leg (null when the id doesn't exist) — link-validation. */
  async kindOf(id: string): Promise<'SHIPMENT' | 'DOCUMENT' | null> {
    const [r] = await this.db
      .select({ kind: schema.shipments.kind })
      .from(schema.shipments)
      .where(eq(schema.shipments.id, id))
    return (r?.kind as 'SHIPMENT' | 'DOCUMENT' | undefined) ?? null
  }

  /**
   * Link a DOCUMENT onto a target SHIPMENT in one transaction: copy its POs and source-emails onto the
   * target (idempotent — ON CONFLICT DO NOTHING against the (shipment,po) / (shipment,graph_id) unique
   * keys), then stamp the document's linked_shipment_id so it leaves the Unlinked Documents view.
   */
  async linkDocument(documentId: string, targetShipmentId: string) {
    await this.db.transaction(async (tx) => {
      const poRows = await tx
        .select({ poId: schema.shipmentPos.poId, quantity: schema.shipmentPos.quantity, quantityUnit: schema.shipmentPos.quantityUnit })
        .from(schema.shipmentPos)
        .where(eq(schema.shipmentPos.shipmentId, documentId))
      if (poRows.length) {
        await tx
          .insert(schema.shipmentPos)
          .values(poRows.map((r) => ({ shipmentId: targetShipmentId, poId: r.poId, quantity: r.quantity, quantityUnit: r.quantityUnit })))
          .onConflictDoNothing()
      }
      const emailRows = await tx
        .select({ graphMessageId: schema.shipmentEmails.graphMessageId, emailType: schema.shipmentEmails.emailType, receivedAt: schema.shipmentEmails.receivedAt })
        .from(schema.shipmentEmails)
        .where(eq(schema.shipmentEmails.shipmentId, documentId))
      if (emailRows.length) {
        await tx
          .insert(schema.shipmentEmails)
          .values(emailRows.map((r) => ({ shipmentId: targetShipmentId, graphMessageId: r.graphMessageId, emailType: r.emailType, receivedAt: r.receivedAt })))
          .onConflictDoNothing()
      }
      await tx
        .update(schema.shipments)
        .set({ linkedShipmentId: targetShipmentId, updatedAt: new Date() })
        .where(eq(schema.shipments.id, documentId))
    })
  }
}
