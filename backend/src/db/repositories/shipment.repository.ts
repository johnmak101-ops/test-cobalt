import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import type { SHIPMENT_STATE } from '../enums'

/** Minimal query-builder surface shared by Kysely<DB> and a Transaction<DB> — lets the link helper
 *  upsert rows on either the main connection or inside a tx. */
type DbLike = Pick<Kysely<DB>, 'selectFrom' | 'insertInto' | 'updateTable' | 'deleteFrom'>

/** Insert/patch shape for a shipment leg row. */
export type ShipmentInsert = Partial<{
  bookingId: string
  legNo: number
  kind: string
  linkedShipmentId: string | null
  dismissedAt: Date | null
  mode: string | null
  state: string
  legStatus: string
  supersededById: string | null
  riskLevel: string
  reviewStatus: string
  confidence: number | null
  reviewReasons: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
  confirmedByEmail: boolean
  forwarderId: string | null
  forwarderRaw: string | null
  consigneeId: string | null
  bookingNo: string | null
  soNo: string | null
  hblAwbFcrNo: string | null
  mbl: string | null
  containerNo: string | null
  vesselName: string | null
  voyageNo: string | null
  scacCode: string | null
  flightNo: string | null
  mawb: string | null
  polId: string | null
  podId: string | null
  polRaw: string | null
  podRaw: string | null
  originCountry: string | null
  cargoReadyDate: Date | null
  cfsCutoff: Date | null
  warehouseStartDate: Date | null
  warehouseEndDate: Date | null
  etd: Date | null
  atd: Date | null
  eta: Date | null
  ata: Date | null
  inDcDate: Date | null
  qty: number | null
  qtyUnit: string | null
  grossWeight: number | null
  measurement: number | null
  htsCode: string | null
  itemStyleNo: string | null
  consigneeName: string | null
  consigneeAddress: string | null
  matchKeys: Record<string, unknown> | null
}>

/** Kysely/SQL Server port of ShipmentRepository. The Shipment aggregate: shipments, shipment_pos,
 *  shipment_milestones, shipment_emails, shipment_identifiers, shipment_parties.
 *
 *  Postgres → MSSQL notes:
 *  - `returning` → `OUTPUT` (.output/.outputAll).
 *  - `onConflictDoNothing` → check-then-insert (the (shipment,po) / (shipment,graph_id) unique keys).
 *  - `count(*)::int` / `array_agg` / `string_agg` → count(*) (number cast) / STRING_AGG.
 *  - Postgres-qualified `tracking.` / `ingest.` schema refs → unqualified (one `dbo` schema in T-SQL).
 *  - `order by … nulls last` → `case when x is null then 1 else 0 end` ascending tiebreak (SQL Server
 *    puts NULLs first in ASC; we push them last explicitly).
 *  - `poNumbers` (Postgres `text[]`) → STRING_AGG(',') split in TS (the consumer treats it as string[]).
 *  - `updateLeg` / `dismissDocument` / `linkPo` returns are not read by callers (verified) — return void/null. */
@Injectable()
export class ShipmentRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  allLegs() {
    return this.db.selectFrom('shipments').selectAll().execute()
  }
  /** Legs for the tracker/dashboard: ACTIVE plus CANCELLED. Only SUPERSEDED legs are hidden. */
  activeLegs() {
    return this.db.selectFrom('shipments').where('legStatus', 'in', ['ACTIVE', 'CANCELLED']).selectAll().execute()
  }
  /** Active AND confirmed — provisional (low-confidence) legs are excluded from alerts/automation. */
  activeConfirmedLegs() {
    return this.db
      .selectFrom('shipments')
      .where('legStatus', '=', 'ACTIVE')
      .where('reviewStatus', '=', 'confirmed')
      .selectAll()
      .execute()
  }
  /** Provisional legs awaiting human review (lowest confidence first). */
  provisionalLegs() {
    return this.db.selectFrom('shipments').where('reviewStatus', '=', 'provisional').orderBy('confidence', 'asc').selectAll().execute()
  }

  /**
   * The shipment-based Review Queue: provisional real shipments awaiting human approval — kind='SHIPMENT',
   * review_status='provisional', not SUPERSEDED. Enriched with booking customer / forwarder / route / po-count.
   * Lowest confidence first.
   */
  reviewQueue() {
    return this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .leftJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipments.kind', '=', 'SHIPMENT')
      .where('shipments.reviewStatus', '=', 'provisional')
      .where('shipments.legStatus', '<>', 'SUPERSEDED')
      .orderBy('shipments.confidence', 'asc')
      .orderBy('shipments.createdAt', 'desc')
      .select([
        'shipments.id as id', 'shipments.bookingNo as bookingNo', 'shipments.soNo as soNo', 'shipments.state as state',
        'shipments.legStatus as legStatus', 'shipments.reviewReasons as reviewReasons', 'shipments.confidence as confidence',
        'shipments.createdAt as createdAt', 'customers.id as customerId', 'customers.name as customerName',
        'customers.code as customerCode', 'forwarders.id as forwarderId', 'forwarders.name as forwarderName',
        'shipments.forwarderRaw as forwarderRaw', 'shipments.mode as mode', 'pol.unlocode as polCode', 'pod.unlocode as podCode',
        'pol.iata as polIata', 'pod.iata as podIata', 'shipments.polRaw as polRaw', 'shipments.podRaw as podRaw',
        sql<number>`(select count(*) from booking_pos bp where bp.booking_id = ${sql.ref('shipments.bookingId')})`.as('poCount'),
      ])
      .execute()
  }

  /** Count of provisional shipments awaiting review — the nav badge. */
  async reviewQueueCount(): Promise<number> {
    const row = await this.db
      .selectFrom('shipments')
      .where('kind', '=', 'SHIPMENT')
      .where('reviewStatus', '=', 'provisional')
      .where('legStatus', '<>', 'SUPERSEDED')
      .select(sql<number>`count(*)`.as('n'))
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  legsForBooking(bookingId: string) {
    return this.db.selectFrom('shipments').where('bookingId', '=', bookingId).orderBy('legNo', 'asc').selectAll().execute()
  }

  async findById(id: string) {
    const row = await this.db.selectFrom('shipments').where('id', '=', id).selectAll().executeTakeFirst()
    return row ?? null
  }

  /** Fetch many legs in ONE query (id -> leg) — replaces per-item findById in read loops (alert summaries). */
  async findByIds(ids: string[]): Promise<Map<string, NonNullable<Awaited<ReturnType<ShipmentRepository['findById']>>>>> {
    const map = new Map<string, NonNullable<Awaited<ReturnType<ShipmentRepository['findById']>>>>()
    if (!ids.length) return map
    const rows = await this.db.selectFrom('shipments').where('id', 'in', ids).selectAll().execute()
    for (const s of rows) map.set(s.id, s)
    return map
  }

  /** matchKeys + reviewReasons are JSON nvarchar(max) columns — stringify when present (callers pass
   *  raw objects/arrays like they did to Drizzle jsonb; tedious rejects non-strings). */
  private jsonifyLegColumns(values: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = { ...values }
    for (const k of ['matchKeys', 'reviewReasons']) {
      if (k in payload) payload[k] = payload[k] != null ? JSON.stringify(payload[k]) : null
    }
    return payload
  }

  async insertLeg(values: Record<string, unknown>) {
    const payload = this.jsonifyLegColumns(values)
    if (!('matchKeys' in payload)) payload.matchKeys = null
    const row = await this.db
      .insertInto('shipments')
      .values(payload as never)
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    return row
  }

  async updateLeg(id: string, patch: Record<string, unknown>) {
    const row = await this.db
      .updateTable('shipments')
      .set({ ...this.jsonifyLegColumns(patch), updatedAt: new Date() })
      .where('id', '=', id)
      .outputAll('inserted')
      .executeTakeFirst()
    return row ?? null
  }

  /** Active legs enriched with booking + customer + forwarder + route, for the Shipment Tracker list. */
  legsForTracker(status?: string) {
    let q = this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .leftJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipments.legStatus', '=', 'ACTIVE')
      .orderBy('shipments.updatedAt', 'desc')
      .select([
        'shipments.id as id', 'shipments.bookingId as bookingId', 'bookings.jobNo as jobNo',
        'shipments.bookingNo as bookingNo', 'shipments.soNo as soNo', 'shipments.hblAwbFcrNo as hblAwbFcrNo',
        'shipments.mbl as mbl', 'shipments.containerNo as containerNo', 'shipments.mode as mode',
        'shipments.state as status', 'shipments.riskLevel as riskLevel', 'shipments.reviewStatus as reviewStatus',
        'shipments.confidence as confidence', 'shipments.etd as etd', 'shipments.eta as eta',
        'shipments.updatedAt as updatedAt', 'customers.id as customerId', 'customers.name as customerName',
        'customers.code as customerCode', 'forwarders.id as forwarderId', 'forwarders.name as forwarderName',
        'shipments.forwarderRaw as forwarderRaw', 'pol.unlocode as polCode', 'pod.unlocode as podCode',
        'pol.iata as polIata', 'pod.iata as podIata', 'shipments.polRaw as polRaw', 'shipments.podRaw as podRaw',
      ])
    if (status) q = q.where('shipments.state', '=', status as (typeof SHIPMENT_STATE)[number])
    return q.execute()
  }

  /** One leg enriched like the tracker list (customer / forwarder / route) — any legStatus, for the detail page. */
  async legDetailById(id: string) {
    const row = await this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .leftJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipments.id', '=', id)
      .select([
        'shipments.id as id', 'shipments.bookingId as bookingId', 'bookings.jobNo as jobNo',
        'shipments.bookingNo as bookingNo', 'shipments.soNo as soNo', 'shipments.hblAwbFcrNo as hblAwbFcrNo',
        'shipments.mbl as mbl', 'shipments.containerNo as containerNo', 'shipments.mode as mode',
        'shipments.state as state', 'shipments.legStatus as legStatus', 'shipments.riskLevel as riskLevel',
        'shipments.reviewStatus as reviewStatus', 'shipments.confidence as confidence',
        'shipments.reviewReasons as reviewReasons', 'shipments.etd as etd', 'shipments.atd as atd',
        'shipments.eta as eta', 'shipments.updatedAt as updatedAt', 'customers.id as customerId',
        'customers.name as customerName', 'customers.code as customerCode', 'forwarders.id as forwarderId',
        'forwarders.name as forwarderName', 'shipments.forwarderRaw as forwarderRaw',
        'pol.unlocode as polCode', 'pod.unlocode as podCode', 'pol.iata as polIata', 'pod.iata as podIata',
        'shipments.polRaw as polRaw', 'shipments.podRaw as podRaw',
      ])
      .executeTakeFirst()
    return row ?? null
  }

  /** A booking's POs (number + vendor + qty) — the expandable child rows on a shipment. */
  linkedPosForBooking(bookingId: string) {
    return this.db
      .selectFrom('bookingPos')
      .innerJoin('purchaseOrders', 'bookingPos.poId', 'purchaseOrders.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .where('bookingPos.bookingId', '=', bookingId)
      .select([
        'purchaseOrders.id as id', 'purchaseOrders.poNumber as poNumber',
        'purchaseOrders.totalQuantity as totalQuantity', 'purchaseOrders.quantityUnit as quantityUnit',
        'vendors.name as vendorName',
      ])
      .execute()
  }

  // --- shipment_pos ---

  /** Idempotently link a shipment to a PO (the `uq_shipment_pos` unique absorbs replays). */
  async linkPo(shipmentId: string, poId: string, quantity: number | null, unit: string | null) {
    const existing = await this.db
      .selectFrom('shipmentPos')
      .where('shipmentId', '=', shipmentId)
      .where('poId', '=', poId)
      .select('id')
      .executeTakeFirst()
    if (existing) return null
    try {
      const row = await this.db
        .insertInto('shipmentPos')
        .values({ shipmentId, poId, quantity, quantityUnit: unit })
        .outputAll('inserted')
        .executeTakeFirst()
      return row ?? null
    } catch (e) {
      // unique violation (shipment_id, po_id) — a concurrent insert won the race; idempotent
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
      return null
    }
  }

  posFor(shipmentId: string) {
    return this.db.selectFrom('shipmentPos').where('shipmentId', '=', shipmentId).selectAll().execute()
  }

  // --- shipment_milestones ---

  milestonesFor(shipmentId: string) {
    return this.db
      .selectFrom('shipmentMilestones')
      .where('shipmentId', '=', shipmentId)
      .orderBy('occurredAt', 'asc')
      .selectAll()
      .execute()
  }

  /** milestonesFor many shipments in ONE query (shipmentId -> milestones, occurredAt order). */
  async milestonesForShipments(ids: string[]) {
    const map = new Map<string, Awaited<ReturnType<ShipmentRepository['milestonesFor']>>>()
    if (!ids.length) return map
    const rows = await this.db
      .selectFrom('shipmentMilestones')
      .where('shipmentId', 'in', ids)
      .orderBy('occurredAt', 'asc')
      .selectAll()
      .execute()
    for (const m of rows) {
      const arr = map.get(m.shipmentId)
      if (arr) arr.push(m)
      else map.set(m.shipmentId, [m])
    }
    return map
  }

  async replaceMilestones(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentMilestones').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentMilestones').values(rows as never).execute()
  }

  /** Every source email that contributed to this shipment (the Related Emails list). */
  async replaceEmails(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentEmails').where('shipmentId', '=', shipmentId).execute()
    if (!rows.length) return
    // insert idempotently on (shipment_id, graph_message_id) — check-then-insert per row
    for (const r of rows) {
      const graphMessageId = r.graphMessageId as string | null
      if (!graphMessageId) continue
      const existing = await this.db
        .selectFrom('shipmentEmails')
        .where('shipmentId', '=', shipmentId)
        .where('graphMessageId', '=', graphMessageId)
        .select('id')
        .executeTakeFirst()
      if (existing) continue
      try {
        await this.db.insertInto('shipmentEmails').values(r as never).execute()
      } catch (e) {
        if (!/unique|duplicate/i.test((e as Error).message)) throw e
      }
    }
  }

  /** The graph message id of the most recent source email for this shipment. Null when none linked. */
  async sourceGraphIdFor(shipmentId: string): Promise<string | null> {
    // Kysely MSSQL emits `limit` verbatim → use TOP 1 via modifyFront.
    const row = await this.db
      .selectFrom('shipmentEmails')
      .where('shipmentId', '=', shipmentId)
      .where('graphMessageId', 'is not', null)
      .orderBy('receivedAt', 'desc')
      .modifyFront(sql`top ${sql.lit(1)}`)
      .select('graphMessageId as g')
      .executeTakeFirst()
    return row?.g ?? null
  }

  // --- shipment_identifiers (every value each identity field ever held — current first) ---

  identifiersFor(shipmentId: string) {
    return this.db
      .selectFrom('shipmentIdentifiers')
      .where('shipmentId', '=', shipmentId)
      .orderBy('isCurrent', 'desc')
      .orderBy('rank', 'desc')
      .selectAll()
      .execute()
  }

  async replaceIdentifiers(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentIdentifiers').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentIdentifiers').values(rows as never).execute()
  }

  // --- shipment_parties (co-valid customer entities with roles — the primary first) ---

  partiesFor(shipmentId: string) {
    return this.db
      .selectFrom('shipmentParties')
      .where('shipmentId', '=', shipmentId)
      .orderBy('isPrimary', 'desc')
      .orderBy('rank', 'desc')
      .selectAll()
      .execute()
  }

  async replaceParties(shipmentId: string, rows: Record<string, unknown>[]) {
    await this.db.deleteFrom('shipmentParties').where('shipmentId', '=', shipmentId).execute()
    if (rows.length) await this.db.insertInto('shipmentParties').values(rows as never).execute()
  }

  // --- documents (kind='DOCUMENT' orphan legs — the Unlinked Documents view) ---

  private static poNumbersSubquery(tableAlias = 'shipments') {
    // Postgres array_agg → STRING_AGG(','); split in TS (the consumer treats it as string[]).
    // (SQL Server STRING_AGG has no DISTINCT — distinct is applied to the inner SELECT here.)
    return sql<string>`coalesce((select string_agg(po.po_number, ',') from (select distinct p2.po_number from shipment_pos sp join purchase_orders p2 on p2.id = sp.po_id where sp.shipment_id = ${sql.ref(tableAlias)}.id) po), '')`.as('poNumbers')
  }

  private static receivedAtMaxExpr(tableAlias = 'shipments') {
    return sql<Date | null>`(select max(se.received_at) from shipment_emails se where se.shipment_id = ${sql.ref(tableAlias)}.id)`
  }

  /**
   * Unlinked documents: kind='DOCUMENT' legs not yet linked onto a real shipment. Enriched with the
   * booking's customer name, distinct email type(s), a best-effort sender type, the PO numbers it carries,
   * and the newest received-at. Ordered newest-first (nulls last). Single query.
   */
  async documents() {
    const rows = await this.db
      .selectFrom('shipments')
      .leftJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .where('shipments.kind', '=', 'DOCUMENT')
      .where('shipments.linkedShipmentId', 'is', null)
      .where('shipments.dismissedAt', 'is', null)
      .orderBy(sql`case when ${ShipmentRepository.receivedAtMaxExpr()} is null then 1 else 0 end`, 'asc')
      .orderBy(ShipmentRepository.receivedAtMaxExpr(), 'desc')
      .select([
        'shipments.id as id', 'customers.name as customerName', 'shipments.qty as qty', 'shipments.qtyUnit as qtyUnit',
        sql<string | null>`(select string_agg(se.email_type, ', ') from (select distinct se2.email_type from shipment_emails se2 where se2.shipment_id = ${sql.ref('shipments.id')} and se2.email_type is not null) se)`.as('emailType'),
        sql<string | null>`(select top 1 pr.sender_type from shipment_emails se join parsed_record pr on pr.graph_message_id = se.graph_message_id where se.shipment_id = ${sql.ref('shipments.id')} and pr.sender_type is not null)`.as('senderType'),
        ShipmentRepository.poNumbersSubquery(),
        ShipmentRepository.receivedAtMaxExpr().as('receivedAt'),
      ])
      .execute()
    return rows.map((r) => ({ ...r, poNumbers: splitPoNumbers(r.poNumbers) }))
  }

  /**
   * One unlinked document's detail (the detail panel): booking customer + email type(s) + sender type +
   * PO numbers + qty + newest received-at, plus the email_message id of its most-recent source email
   * (joined shipment_emails.graph_message_id → email_message.graph_message_id). Null when not a document.
   */
  async documentDetail(id: string) {
    const row = await this.db
      .selectFrom('shipments')
      .leftJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .leftJoin('customers', 'bookings.customerId', 'customers.id')
      .where('shipments.id', '=', id)
      .where('shipments.kind', '=', 'DOCUMENT')
      .select([
        'shipments.id as id', 'customers.name as customerName', 'shipments.qty as qty', 'shipments.qtyUnit as qtyUnit',
        sql<string | null>`(select string_agg(se.email_type, ', ') from (select distinct se2.email_type from shipment_emails se2 where se2.shipment_id = ${sql.ref('shipments.id')} and se2.email_type is not null) se)`.as('emailType'),
        sql<string | null>`(select top 1 pr.sender_type from shipment_emails se join parsed_record pr on pr.graph_message_id = se.graph_message_id where se.shipment_id = ${sql.ref('shipments.id')} and pr.sender_type is not null)`.as('senderType'),
        ShipmentRepository.poNumbersSubquery(),
        ShipmentRepository.receivedAtMaxExpr().as('receivedAt'),
        sql<string | null>`(select top 1 qm.id from shipment_emails se join email_message qm on qm.graph_message_id = se.graph_message_id where se.shipment_id = ${sql.ref('shipments.id')} order by case when se.received_at is null then 1 else 0 end asc, se.received_at desc)`.as('emailId'),
      ])
      .executeTakeFirst()
    if (!row) return null
    return { ...row, poNumbers: splitPoNumbers(row.poNumbers) }
  }

  /** Mark an unlinked document dismissed (idempotent) — it drops off the Unlinked Documents list. */
  async dismissDocument(id: string) {
    await this.db
      .updateTable('shipments')
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('kind', '=', 'DOCUMENT')
      .execute()
  }

  /** kind lookup for a leg (null when the id doesn't exist) — link-validation. */
  async kindOf(id: string): Promise<'SHIPMENT' | 'DOCUMENT' | null> {
    const row = await this.db.selectFrom('shipments').where('id', '=', id).select('kind as kind').executeTakeFirst()
    return (row?.kind as 'SHIPMENT' | 'DOCUMENT' | undefined) ?? null
  }

  /**
   * Link a DOCUMENT onto a target SHIPMENT in one transaction: copy its POs and source-emails onto the
   * target (idempotent against the (shipment,po) / (shipment,graph_id) unique keys), then stamp the
   * document's linked_shipment_id so it leaves the Unlinked Documents view.
   */
  async linkDocument(documentId: string, targetShipmentId: string) {
    await this.db.transaction().execute(async (tx) => {
      const poRows = await tx
        .selectFrom('shipmentPos')
        .where('shipmentId', '=', documentId)
        .select(['poId', 'quantity', 'quantityUnit'])
        .execute()
      for (const r of poRows) {
        await upsertShipmentPo(tx, targetShipmentId, r.poId, r.quantity, r.quantityUnit)
      }
      const emailRows = await tx
        .selectFrom('shipmentEmails')
        .where('shipmentId', '=', documentId)
        .select(['graphMessageId', 'emailType', 'receivedAt'])
        .execute()
      for (const r of emailRows) {
        await upsertShipmentEmail(tx, targetShipmentId, r.graphMessageId, r.emailType, r.receivedAt)
      }
      await tx
        .updateTable('shipments')
        .set({ linkedShipmentId: targetShipmentId, updatedAt: new Date() })
        .where('id', '=', documentId)
        .execute()
    })
  }
}

/** Split the STRING_AGG'd po_numbers column into the string[] the consumer expects ('' → []). */
function splitPoNumbers(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(',').filter(Boolean)
}

/** Idempotent upsert of a (shipment, po) link — check-then-insert, `uq_shipment_pos` absorbs replays. */
async function upsertShipmentPo(
  tx: DbLike,
  shipmentId: string,
  poId: string,
  quantity: number | null,
  quantityUnit: string | null,
) {
  const existing = await tx.selectFrom('shipmentPos').where('shipmentId', '=', shipmentId).where('poId', '=', poId).select('id').executeTakeFirst()
  if (existing) return
  try {
    await tx.insertInto('shipmentPos').values({ shipmentId, poId, quantity, quantityUnit }).execute()
  } catch (e) {
    if (!/unique|duplicate/i.test((e as Error).message)) throw e
  }
}

/** Idempotent upsert of a (shipment, graph_message_id) email link. */
async function upsertShipmentEmail(
  tx: DbLike,
  shipmentId: string,
  graphMessageId: string | null,
  emailType: string | null,
  receivedAt: Date | null,
) {
  if (!graphMessageId) return
  const existing = await tx.selectFrom('shipmentEmails').where('shipmentId', '=', shipmentId).where('graphMessageId', '=', graphMessageId).select('id').executeTakeFirst()
  if (existing) return
  try {
    await tx.insertInto('shipmentEmails').values({ shipmentId, graphMessageId, emailType, receivedAt }).execute()
  } catch (e) {
    if (!/unique|duplicate/i.test((e as Error).message)) throw e
  }
}
