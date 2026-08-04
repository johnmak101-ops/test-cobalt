/**
 * ERP export — the PO-grained JSON feed for Mesh (and the PO-lookup chatbot).
 *
 * Grain: one object per PO, the shipment legs that carry it nested under `shipments` — the ERP is
 * PO-based, and the PO↔leg relationship is many-to-many (one 51-PO booking; one PO split across
 * legs), so nesting is the only shape that stays honest in both directions.
 *
 * Gating (the export is outward-facing — the ERP must not be polluted with pipeline artifacts):
 *   - kind='SHIPMENT' only (DOCUMENT rows are pipeline artifacts)
 *   - leg_status: ACTIVE; CANCELLED only via includeCancelled (a cancellation IS information);
 *     SUPERSEDED/dismissed never leave (activeLegs already hides them)
 *   - review_status: confirmed; provisional only via includeProvisional (rows then say so)
 *   - POs with no surviving leg are not emitted — this is shipping-status backfill, an unshipped
 *     PO has nothing to report
 *
 * Field selection is per-request (`?fields=a,b,c`, validated against the catalog); identity fields
 * are always included. No selection → the full catalog.
 */
import { BadRequestException, Injectable } from '@nestjs/common'
import { ShipmentRepository } from '../db/repositories/shipment.repository'
import { BookingRepository } from '../db/repositories/booking.repository'
import { MastersRepository } from '../db/repositories/masters.repository'
import { poNumberNorm } from '../db/repositories/purchase-order.repository'
import { SHIPMENT_STATE } from '../db/enums'
import {
  ERP_EXPORT_FIELDS,
  resolveSelection,
  type ErpExportField,
  type ExportLegRow,
  type ExportPoCtx,
  type ExportShipmentCtx,
} from './field-catalog'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

/** Raw query-string inputs (the controller passes them through unparsed). */
export interface ErpExportQuery {
  since?: string
  poNumber?: string
  jobNo?: string
  state?: string
  fields?: string
  includeProvisional?: string
  includeCancelled?: string
  limit?: string
  offset?: string
}

type LegRow = ExportLegRow & {
  bookingId: string
  kind?: string | null
  polId?: string | null
  podId?: string | null
}

type PoLink = {
  quantity: number | null
  quantityUnit: string | null
  inferred: boolean | null
  level: 'shipment' | 'booking'
}

type PoGroup = {
  po: ExportPoCtx
  poNumberNorm: string
  entries: { leg: LegRow; link: PoLink }[]
}

/** The PO-master columns both export link queries share (exportPoColumns select). */
type PoMasterRow = {
  poId: string
  poNumber: string
  poNumberNorm: string | null
  brand: string | null
  itemStyleNo: string | null
  totalQuantity: number | null
  quantityUnit: string | null
  crd: Date | string | null
  customerCode: string | null
  customerName: string | null
  vendorCode: string | null
  vendorName: string | null
}

const flag = (v: string | undefined) => v === 'true' || v === '1'

const ts = (d: Date | string | null | undefined): number =>
  d == null ? 0 : (d instanceof Date ? d : new Date(String(d))).getTime()

@Injectable()
export class ErpExportService {
  constructor(
    private readonly shipmentRepo: ShipmentRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly mastersRepo: MastersRepository,
  ) {}

  /** The catalog, for the consumer to discover what `fields=` can ask for. */
  listFields() {
    return {
      fields: ERP_EXPORT_FIELDS.map((f) => ({
        key: f.key,
        level: f.level,
        group: f.group,
        description: f.description,
        always: f.always === true,
      })),
    }
  }

  async exportPos(q: ErpExportQuery) {
    const parsed = this.parseQuery(q)

    // 1) Candidate legs (ACTIVE+CANCELLED, dismissed/superseded already hidden) → gate.
    const allLegs = (await this.shipmentRepo.activeLegs()) as unknown as LegRow[]
    let legs = allLegs.filter(
      (l) =>
        (l.kind ?? 'SHIPMENT') === 'SHIPMENT' &&
        (l.legStatus !== 'CANCELLED' || parsed.includeCancelled) &&
        (l.reviewStatus !== 'provisional' || parsed.includeProvisional) &&
        (!parsed.state || l.state === parsed.state),
    )

    // 2) Bookings (jobNo + booking-resolved parties).
    const bookings = await this.bookingRepo.findByIds([...new Set(legs.map((l) => l.bookingId))])
    if (parsed.jobNo) {
      const wanted = parsed.jobNo
      legs = legs.filter((l) => (bookings.get(l.bookingId)?.jobNo ?? '').trim().toUpperCase() === wanted)
    }

    // 3) PO links: per-leg shipment_pos first; booking-level fallback for legacy legs without any.
    const shipLinks = await this.shipmentRepo.exportPoLinksForShipments(legs.map((l) => l.id))
    const linksByLeg = new Map<string, typeof shipLinks>()
    for (const r of shipLinks) {
      const arr = linksByLeg.get(r.shipmentId)
      if (arr) arr.push(r)
      else linksByLeg.set(r.shipmentId, [r])
    }
    const orphanBookingIds = [...new Set(legs.filter((l) => !linksByLeg.has(l.id)).map((l) => l.bookingId))]
    const bookingLinks = await this.shipmentRepo.exportPoLinksForBookings(orphanBookingIds)
    const linksByBooking = new Map<string, typeof bookingLinks>()
    for (const r of bookingLinks) {
      const arr = linksByBooking.get(r.bookingId)
      if (arr) arr.push(r)
      else linksByBooking.set(r.bookingId, [r])
    }

    // 4) Group by PO.
    const groups = new Map<string, PoGroup>()
    const addEntry = (
      r: PoMasterRow & { legQty?: number | null; legQtyUnit?: string | null; inferred?: boolean | null },
      leg: LegRow,
      level: PoLink['level'],
    ) => {
      let g = groups.get(r.poId)
      if (!g) {
        g = {
          po: {
            poNumber: r.poNumber,
            brand: r.brand ?? null,
            itemStyleNo: r.itemStyleNo ?? null,
            totalQuantity: r.totalQuantity ?? null,
            quantityUnit: r.quantityUnit ?? null,
            crd: r.crd ?? null,
            customerCode: r.customerCode ?? null,
            customerName: r.customerName ?? null,
            vendorCode: r.vendorCode ?? null,
            vendorName: r.vendorName ?? null,
          },
          poNumberNorm: r.poNumberNorm ?? poNumberNorm(r.poNumber),
          entries: [],
        }
        groups.set(r.poId, g)
      }
      g.entries.push({
        leg,
        link:
          level === 'shipment'
            ? { quantity: r.legQty ?? null, quantityUnit: r.legQtyUnit ?? null, inferred: !!r.inferred, level }
            : { quantity: null, quantityUnit: null, inferred: null, level },
      })
    }
    for (const leg of legs) {
      const own = linksByLeg.get(leg.id)
      if (own) for (const r of own) addEntry(r, leg, 'shipment')
      else for (const r of linksByBooking.get(leg.bookingId) ?? []) addEntry(r, leg, 'booking')
    }

    // 5) PO-level filters: tolerant poNumber lookup; `since` keeps a PO when ANY of its legs moved
    //    (the nested array stays complete — the consumer always sees the whole PO picture).
    let list = [...groups.values()]
    if (parsed.poNumberNorm) list = list.filter((g) => g.poNumberNorm === parsed.poNumberNorm)
    if (parsed.since != null) {
      const cutoff = parsed.since
      list = list.filter((g) => g.entries.some((e) => ts(e.leg.updatedAt) > cutoff))
    }

    // 6) Stable order + pagination at the PO grain.
    list.sort((a, b) => a.po.poNumber.localeCompare(b.po.poNumber))
    const total = list.length
    const page = list.slice(parsed.offset, parsed.offset + parsed.limit)

    // 7) Reference data for the page only (masters, carriers, ports, milestones) — batched, no N+1.
    const pageLegs = new Map<string, LegRow>()
    for (const g of page) for (const e of g.entries) pageLegs.set(e.leg.id, e.leg)
    const portIds = [...pageLegs.values()].flatMap((l) => [l.polId, l.podId]).filter((x): x is string => !!x)
    const [customers, vendors, forwarders, carriers, ports, milestones] = await Promise.all([
      this.mastersRepo.listCustomers(),
      this.mastersRepo.listVendors(),
      this.mastersRepo.listForwarders(),
      this.mastersRepo.listCarriers(),
      this.mastersRepo.portsByIds([...new Set(portIds)]),
      this.shipmentRepo.milestonesForShipments([...pageLegs.keys()]),
    ])
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]))
    const customersById = byId(customers)
    const vendorsById = byId(vendors)
    const forwardersById = byId(forwarders)
    const portsById = byId(ports)
    const carrierByScac = new Map(carriers.map((c) => [c.scac.trim().toUpperCase(), c.name]))

    // 8) Assemble through the catalog extractors, honoring the field selection.
    const poFields = parsed.fields.filter((f): f is Extract<ErpExportField, { level: 'po' }> => f.level === 'po')
    const shipFields = parsed.fields.filter(
      (f): f is Extract<ErpExportField, { level: 'shipment' }> => f.level === 'shipment',
    )
    const pos = page.map((g) => {
      const out: Record<string, unknown> = {}
      for (const f of poFields) out[f.key] = f.extract(g.po)
      const entries = [...g.entries].sort((a, b) => {
        const ja = bookings.get(a.leg.bookingId)?.jobNo ?? ''
        const jb = bookings.get(b.leg.bookingId)?.jobNo ?? ''
        return ja.localeCompare(jb) || (a.leg.legNo ?? 1) - (b.leg.legNo ?? 1)
      })
      out.shipments = entries.map((e) => {
        const booking = bookings.get(e.leg.bookingId) ?? null
        const customer = booking?.customerId ? customersById.get(booking.customerId) : undefined
        const vendor = booking?.vendorId ? vendorsById.get(booking.vendorId) : undefined
        const forwarder = (e.leg as { forwarderId?: string | null }).forwarderId
          ? forwardersById.get((e.leg as { forwarderId?: string | null }).forwarderId as string)
          : undefined
        const polPort = e.leg.polId ? portsById.get(e.leg.polId) : undefined
        const podPort = e.leg.podId ? portsById.get(e.leg.podId) : undefined
        const ctx: ExportShipmentCtx = {
          leg: e.leg,
          jobNo: booking?.jobNo ?? null,
          customer: customer ? { code: customer.code ?? null, name: customer.name } : null,
          vendor: vendor ? { code: vendor.code ?? null, name: vendor.name } : null,
          forwarder: forwarder ? { code: forwarder.code ?? null, name: forwarder.name } : null,
          polPort: polPort
            ? { unlocode: polPort.unlocode ?? null, iata: polPort.iata ?? null, name: polPort.name ?? null, country: polPort.country ?? null }
            : null,
          podPort: podPort
            ? { unlocode: podPort.unlocode ?? null, iata: podPort.iata ?? null, name: podPort.name ?? null, country: podPort.country ?? null }
            : null,
          carrierName: e.leg.scacCode ? carrierByScac.get(e.leg.scacCode.trim().toUpperCase()) ?? null : null,
          link: e.link,
          milestones: milestones.get(e.leg.id) ?? [],
        }
        const row: Record<string, unknown> = {}
        for (const f of shipFields) row[f.key] = f.extract(ctx)
        return row
      })
      return out
    })

    return {
      generated_at: new Date().toISOString(),
      total,
      count: pos.length,
      offset: parsed.offset,
      limit: parsed.limit,
      fields: parsed.fields.map((f) => f.key),
      pos,
    }
  }

  private parseQuery(q: ErpExportQuery) {
    let since: number | null = null
    if (q.since != null && q.since !== '') {
      const d = new Date(q.since)
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`invalid since: ${q.since} (expected an ISO date)`)
      since = d.getTime()
    }

    let state: string | null = null
    if (q.state != null && q.state !== '') {
      const v = q.state.trim().toUpperCase()
      if (!(SHIPMENT_STATE as readonly string[]).includes(v))
        throw new BadRequestException(`invalid state: ${q.state} (valid: ${SHIPMENT_STATE.join(', ')})`)
      state = v
    }

    let poNorm: string | null = null
    if (q.poNumber != null && q.poNumber !== '') {
      poNorm = poNumberNorm(q.poNumber)
      if (!poNorm) throw new BadRequestException(`invalid poNumber: ${q.poNumber}`)
    }

    const requested =
      q.fields != null && q.fields !== ''
        ? q.fields.split(',').map((s) => s.trim()).filter(Boolean)
        : null
    const { fields, unknown } = resolveSelection(requested)
    if (unknown.length)
      throw new BadRequestException(
        `unknown fields: ${unknown.join(', ')} — see GET /api/erp-export/fields for the catalog`,
      )

    const limit = q.limit != null && q.limit !== '' ? Number(q.limit) : DEFAULT_LIMIT
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
      throw new BadRequestException(`invalid limit: ${q.limit} (1..${MAX_LIMIT})`)
    const offset = q.offset != null && q.offset !== '' ? Number(q.offset) : 0
    if (!Number.isInteger(offset) || offset < 0) throw new BadRequestException(`invalid offset: ${q.offset}`)

    return {
      since,
      state,
      poNumberNorm: poNorm,
      jobNo: q.jobNo != null && q.jobNo.trim() !== '' ? q.jobNo.trim().toUpperCase() : null,
      fields,
      includeProvisional: flag(q.includeProvisional),
      includeCancelled: flag(q.includeCancelled),
      limit,
      offset,
    }
  }
}
