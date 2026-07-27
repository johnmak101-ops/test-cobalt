import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'
import { isStyleTokenSuperset, isEntirelyPoShapedStyle } from '../../lib/style-tokens'

export type PoEnrichInput = Partial<{ brand: string | null; itemStyleNo: string | null; totalQuantity: number | null; quantityUnit: string | null; qtyConflict: string[] | null }>

/** Normalized PO key for the queryable `po_number_norm` index (0004). A FROZEN parity copy of match-keys.ts
 *  `normKey` (strip non-alphanumerics + upper-case) — kept LOCAL to avoid a db→reconcile layer import. The
 *  committer's PO-candidate query compares this against `normKey`-computed groupPos, so it MUST stay
 *  byte-identical to `normKey`; the committer-candidate-query int specs seed raw + query normalized, guarding
 *  the parity end-to-end. */
const poNumberNorm = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Kysely/SQL Server port of PurchaseOrderRepository. PO master reads + CRUD + PO↔shipment links. */
@Injectable()
export class PurchaseOrderRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /** PO master with customer/vendor codes resolved + shipped-qty/shipment-count/furthest-status aggregates. */
  async listPos(openOnly = false) {
    const rows = await this.db.selectFrom('purchaseOrders')
      .leftJoin('customers', 'purchaseOrders.customerId', 'customers.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .orderBy('purchaseOrders.poNumber')
      .select([
        'purchaseOrders.id as id', 'purchaseOrders.poNumber as poNumber', 'customers.code as customerCode',
        'customers.name as customerName', 'vendors.code as vendorCode', 'vendors.name as vendorName',
        'purchaseOrders.brand as brand', 'purchaseOrders.itemStyleNo as itemStyleNo',
        'purchaseOrders.totalQuantity as totalQuantity', 'purchaseOrders.quantityUnit as quantityUnit',
        'purchaseOrders.crd as crd', 'purchaseOrders.customerId as customerId', 'purchaseOrders.vendorId as vendorId',
        'purchaseOrders.notes as notes', 'purchaseOrders.createdAt as createdAt', 'purchaseOrders.updatedAt as updatedAt',
      ])
      .execute()

    // aggregates: shipped qty (sum), shipment count (distinct), furthest state (MAX of the state-rank)
    // Rejected legs are excluded everywhere a PO's links are read (2026-07-27): dismiss() only stamps
    // dismissed_at and never unlinks, so a thrown-away leg kept counting toward the PO's shipped
    // quantity, its shipment count and its furthest status — the header-row leg `PO # :` alone was
    // holding 7 POs. A leg nobody accepted is not a shipment of the order.
    const agg = await this.db.selectFrom('shipmentPos')
      .innerJoin('shipments', 'shipmentPos.shipmentId', 'shipments.id')
      .where('shipments.dismissedAt', 'is', null)
      .groupBy('shipmentPos.poId')
      .select([
        'shipmentPos.poId as poId',
        sql<number>`coalesce(sum(${sql.ref('shipmentPos.quantity')}), 0)`.as('shipped'),
        sql<number>`count(distinct ${sql.ref('shipmentPos.shipmentId')})`.as('shipments'),
        sql<string | null>`max(${sql.ref('shipmentPos.quantityUnit')})`.as('unit'),
        sql<string | null>`max(case ${sql.ref('shipments.state')} when 'DELIVERED' then 6 when 'RELEASED' then 5 when 'SAILED' then 4 when 'AT_WAREHOUSE' then 3 when 'CONFIRMED' then 2 else 1 end)`.as('statusRank'),
      ])
      .execute()
    // map statusRank back to the state string
    const rankToState: Record<number, string> = { 1: 'BOOKED', 2: 'CONFIRMED', 3: 'AT_WAREHOUSE', 4: 'SAILED', 5: 'RELEASED', 6: 'DELIVERED' }
    const aggMap = new Map(agg.map((a) => [a.poId, a]))
    const enriched = rows.map((r) => {
      const a = aggMap.get(r.id)
      const rank = a?.statusRank != null ? Number(a.statusRank) : null
      return {
        ...r,
        shippedQuantity: a ? Number(a.shipped) : 0,
        shipmentCount: a ? Number(a.shipments) : 0,
        shippedUnit: a?.unit ?? null,
        status: rank != null ? (rankToState[rank] ?? null) : null,
      }
    })

    if (!openOnly) return enriched
    const closedLinks = await this.db.selectFrom('bookingPos')
      .innerJoin('bookings', 'bookingPos.bookingId', 'bookings.id')
      .where('bookings.status', 'in', ['CLOSED', 'CANCELLED'])
      .select('bookingPos.poId as poId')
      .execute()
    const closed = new Set(closedLinks.map((r) => r.poId))
    return enriched.filter((r) => !closed.has(r.id))
  }

  /** A single PO with the shipments (legs) it rides on. */
  async poDetail(poId: string) {
    const po = await this.db.selectFrom('purchaseOrders')
      .leftJoin('customers', 'purchaseOrders.customerId', 'customers.id')
      .leftJoin('vendors', 'purchaseOrders.vendorId', 'vendors.id')
      .where('purchaseOrders.id', '=', poId)
      .select([
        'purchaseOrders.id as id', 'purchaseOrders.poNumber as poNumber', 'purchaseOrders.brand as brand',
        'purchaseOrders.itemStyleNo as itemStyleNo', 'purchaseOrders.totalQuantity as totalQuantity',
        'purchaseOrders.quantityUnit as quantityUnit', 'purchaseOrders.crd as crd',
        'purchaseOrders.customerId as customerId', 'purchaseOrders.vendorId as vendorId',
        'purchaseOrders.notes as notes', 'customers.code as customerCode', 'customers.name as customerName',
        'vendors.code as vendorCode', 'vendors.name as vendorName',
        'purchaseOrders.createdAt as createdAt', 'purchaseOrders.updatedAt as updatedAt',
      ])
      .executeTakeFirst()
    if (!po) return null

    const links = await this.db.selectFrom('shipmentPos')
      .innerJoin('shipments', 'shipmentPos.shipmentId', 'shipments.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      .where('shipmentPos.poId', '=', poId)
      // see listPos: a rejected leg is not a shipment of this order
      .where('shipments.dismissedAt', 'is', null)
      .select([
        'shipmentPos.id as linkId', 'shipmentPos.shipmentId as shipmentId', 'shipmentPos.quantity as linkedQuantity',
        'shipments.state as status', 'shipments.legStatus as legStatus', 'shipments.reviewStatus as reviewStatus',
        'shipments.bookingNo as bookingNo', 'shipments.hblAwbFcrNo as hbl', 'shipments.soNo as so',
        'shipments.etd as etd', 'shipments.eta as eta', 'shipments.mode as mode',
        'pol.unlocode as polCode', 'pod.unlocode as podCode', 'pol.iata as polIata', 'pod.iata as podIata',
        'shipmentPos.createdAt as linkedAt', 'shipments.containerNo as containerNo', 'shipments.mbl as mbl',
        'shipments.scacCode as scacCode', 'shipments.vesselName as vesselName',
        // #350/#354: anchor fields for the derived Shipment ID on the detail's Linked Shipments rows
        'shipments.createdAt as shipmentCreatedAt',
        sql<Date | null>`(select min(se.received_at) from shipment_emails se where se.shipment_id = shipments.id)`.as('firstEmailAt'),
      ])
      .execute()
    return { po, links }
  }

  /** Every PO's linked shipments with the PO-list search fields, batched. */
  shipmentSummariesByPo() {
    return this.db.selectFrom('shipmentPos')
      .innerJoin('shipments', 'shipmentPos.shipmentId', 'shipments.id')
      .leftJoin('ports as pol', 'shipments.polId', 'pol.id')
      .leftJoin('ports as pod', 'shipments.podId', 'pod.id')
      // see listPos: a rejected leg is not a shipment of this order
      .where('shipments.dismissedAt', 'is', null)
      .select([
        'shipmentPos.poId as poId', 'shipmentPos.shipmentId as shipmentId', 'shipmentPos.quantity as linkedQuantity',
        'shipments.bookingNo as bookingNo', 'shipments.state as status', 'shipments.legStatus as legStatus',
        'shipments.reviewStatus as reviewStatus', 'shipments.containerNo as containerNo',
        'shipments.hblAwbFcrNo as hbl', 'shipments.mbl as mbl', 'shipments.scacCode as scacCode',
        'shipments.vesselName as vesselName', 'shipments.mode as mode',
        'pol.unlocode as polCode', 'pod.unlocode as podCode', 'pol.iata as polIata', 'pod.iata as podIata',
      ])
      .execute()
  }

  /** Find-or-create a PO by number; enrich brand/style/qty on INSERT, fill-if-null on existing (human-wins). */
  async upsertPo(poNumber: string, customerId: string | null, vendorId: string | null, enrich?: PoEnrichInput) {
    // check-then-insert (MSSQL has no ON CONFLICT DO NOTHING). A unique-index violation from a concurrent
    // insert is caught → fall through to the read + fill-if-null path.
    try {
      const inserted = await this.db.insertInto('purchaseOrders').values({
        poNumber, poNumberNorm: poNumberNorm(poNumber), customerId, vendorId,
        brand: enrich?.brand ?? null, itemStyleNo: enrich?.itemStyleNo ?? null,
        totalQuantity: enrich?.totalQuantity ?? null, quantityUnit: enrich?.quantityUnit ?? null,
      }).output('inserted.id').executeTakeFirst()
      if (inserted) return inserted.id
    } catch (e) {
      // unique violation (po_number) — fall through to read + fill-if-null
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
    }
    const existing = await this.db.selectFrom('purchaseOrders').where('poNumber', '=', poNumber).selectAll().executeTakeFirst()
    if (!existing) throw new Error(`upsertPo: purchase_order ${poNumber} conflicted but was not found`)
    if (enrich) {
      const patch: PoEnrichInput = {}
      if (existing.brand == null && enrich.brand != null) patch.brand = enrich.brand
      // itemStyleNo: fill-if-null, or upgrade when enrich is a proper token superset
      // (incomplete single on PO must not block a fuller multi-style list). Never shrink.
      // Exceptions:
      //  - existing entirely PO-shaped garbage (P028642) → replace or clear
      //  - packing form Code/Description (C193/FERN JUMPER) upgrades bare name or bare code
      const isPackingFormStyle = (s: string | null | undefined): boolean => {
        if (!s || !s.includes('/')) return false
        const [code, ...rest] = s.split('/')
        const desc = rest.join('/').trim()
        return Boolean(code && /[A-Z]/i.test(code) && /\d/.test(code) && desc.length >= 2)
      }
      if (existing.itemStyleNo == null && enrich.itemStyleNo != null) {
        patch.itemStyleNo = enrich.itemStyleNo
      } else if (
        existing.itemStyleNo != null &&
        enrich.itemStyleNo != null &&
        isStyleTokenSuperset(enrich.itemStyleNo, existing.itemStyleNo)
      ) {
        patch.itemStyleNo = enrich.itemStyleNo
      } else if (
        existing.itemStyleNo != null &&
        enrich.itemStyleNo != null &&
        isPackingFormStyle(enrich.itemStyleNo) &&
        !isPackingFormStyle(existing.itemStyleNo)
      ) {
        // Packing form Code/Description beats bare description or bare style code
        patch.itemStyleNo = enrich.itemStyleNo
      } else if (
        existing.itemStyleNo != null &&
        isEntirelyPoShapedStyle(existing.itemStyleNo) &&
        enrich.itemStyleNo != null &&
        !isEntirelyPoShapedStyle(enrich.itemStyleNo)
      ) {
        patch.itemStyleNo = enrich.itemStyleNo
      } else if (
        existing.itemStyleNo != null &&
        isEntirelyPoShapedStyle(existing.itemStyleNo) &&
        (enrich.itemStyleNo == null || isEntirelyPoShapedStyle(enrich.itemStyleNo))
      ) {
        // Clear garbage even when rematch has nothing better (null)
        patch.itemStyleNo = null
      }
      if (enrich.qtyConflict) {
        // The PO ships on >1 leg with diverging qty/unit. Whatever total is already stored was adopted
        // from whichever leg committed FIRST (first-writer-wins below) and is a per-leg SHIPPED figure,
        // not the ordered total — clear it so the other leg stops reading as mis-shipped. Ops refills
        // from ERP; the committer raises a "qty conflict … across legs" review reason.
        if (existing.totalQuantity != null) patch.totalQuantity = null
        if (existing.quantityUnit != null) patch.quantityUnit = null
      } else {
        if (existing.totalQuantity == null && enrich.totalQuantity != null) patch.totalQuantity = enrich.totalQuantity
        if (existing.quantityUnit == null && enrich.quantityUnit != null) patch.quantityUnit = enrich.quantityUnit
      }
      if (Object.keys(patch).length) {
        await this.db.updateTable('purchaseOrders').set({ ...patch, updatedAt: new Date() }).where('id', '=', existing.id).execute()
      }
    }
    return existing.id
  }

  async poById(id: string) {
    const row = await this.db.selectFrom('purchaseOrders').where('id', '=', id).selectAll().executeTakeFirst()
    return row ?? null
  }
  async findPoByNumber(poNumber: string) {
    const row = await this.db.selectFrom('purchaseOrders').where('poNumber', '=', poNumber).selectAll().executeTakeFirst()
    return row ?? null
  }
  async createPo(values: {
    poNumber: string
    customerId?: string | null
    vendorId?: string | null
    brand?: string | null
    itemStyleNo?: string | null
    totalQuantity?: number | null
    quantityUnit?: string | null
    notes?: string | null
  }) {
    const row = await this.db
      .insertInto('purchaseOrders')
      .values({ ...values, poNumberNorm: poNumberNorm(values.poNumber) })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
    return row
  }
  async updatePo(id: string, patch: Record<string, unknown>) {
    // keep po_number_norm in lockstep with po_number when the number is edited (the candidate query reads it).
    const set: Record<string, unknown> = { ...patch, updatedAt: new Date() }
    if ('poNumber' in patch) set.poNumberNorm = poNumberNorm(patch.poNumber)
    const row = await this.db.updateTable('purchaseOrders').set(set as never).where('id', '=', id).outputAll('inserted').executeTakeFirst()
    return row ?? null
  }
  async poLinkCounts(id: string) {
    const s = await this.db.selectFrom('shipmentPos').where('poId', '=', id).select(sql<number>`count(*)`.as('n')).executeTakeFirst()
    const b = await this.db.selectFrom('bookingPos').where('poId', '=', id).select(sql<number>`count(*)`.as('n')).executeTakeFirst()
    return { shipments: Number(s?.n ?? 0), bookings: Number(b?.n ?? 0) }
  }
  async deletePo(id: string) {
    const row = await this.db.deleteFrom('purchaseOrders').where('id', '=', id).outputAll('deleted').executeTakeFirst()
    return row ?? null
  }
  async linkShipmentPo(poId: string, shipmentId: string, quantity: number | null, quantityUnit: string | null) {
    // check-then-insert (the unique (shipment_id, po_id) absorbs replays)
    const existing = await this.db.selectFrom('shipmentPos').where('poId', '=', poId).where('shipmentId', '=', shipmentId).select('id').executeTakeFirst()
    if (existing) return null
    const row = await this.db.insertInto('shipmentPos').values({ poId, shipmentId, quantity, quantityUnit }).outputAll('inserted').executeTakeFirst()
    return row ?? null
  }
  async unlinkShipmentPo(poId: string, linkId: string) {
    const row = await this.db.deleteFrom('shipmentPos').where('id', '=', linkId).where('poId', '=', poId).outputAll('deleted').executeTakeFirst()
    return row ?? null
  }
}
