import { describe, it, expect } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { ErpExportService } from './erp-export.service'
import type { ShipmentRepository } from '../db/repositories/shipment.repository'
import type { BookingRepository } from '../db/repositories/booking.repository'
import type { MastersRepository } from '../db/repositories/masters.repository'

/** Leg fixture with the columns the export reads; overrides per case. */
const makeLeg = (over: Record<string, unknown>) => ({
  id: 'leg',
  bookingId: 'b1',
  kind: 'SHIPMENT',
  legNo: 1,
  state: 'RELEASED',
  legStatus: 'ACTIVE',
  reviewStatus: 'confirmed',
  riskLevel: 'ON_TRACK',
  mode: 'SEA',
  journey: null,
  bookingNo: null,
  soNo: null,
  hblAwbFcrNo: null,
  mbl: null,
  containerNo: null,
  vesselName: null,
  voyageNo: null,
  scacCode: 'COSU',
  polRaw: null,
  podRaw: null,
  originCountry: null,
  polId: 'p1',
  podId: 'p2',
  forwarderId: 'f1',
  cargoReadyDate: null,
  cfsCutoff: null,
  warehouseStartDate: null,
  warehouseEndDate: null,
  etd: new Date('2026-07-28T00:00:00Z'),
  atd: null,
  eta: new Date('2026-08-12T00:00:00Z'),
  ata: null,
  inDcDate: null,
  qty: 5000,
  qtyUnit: 'cartons',
  grossWeight: null,
  measurement: null,
  htsCode: null,
  itemStyleNo: null,
  forwarderRaw: null,
  consigneeName: null,
  consigneeAddress: null,
  createdAt: new Date('2026-07-10T00:00:00Z'),
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  ...over,
})

/** PO-link row fixture (exportPoLinksForShipments shape). */
const poRow = (shipmentId: string, poId: string, poNumber: string, over: Record<string, unknown> = {}) => ({
  shipmentId,
  legQty: null as number | null,
  legQtyUnit: null as string | null,
  inferred: false,
  poId,
  poNumber,
  poNumberNorm: poNumber.toUpperCase().replace(/[^A-Z0-9]/g, ''),
  brand: null,
  itemStyleNo: null,
  totalQuantity: 5000,
  quantityUnit: 'cartons',
  crd: null,
  customerCode: 'SOUOCE',
  customerName: 'Source International Ltd',
  vendorCode: 'HONCOS',
  vendorName: 'Hongyuan Costume Co Ltd',
  ...over,
})

const LEGS = [
  makeLeg({ id: 'A', bookingId: 'b1', state: 'RELEASED', updatedAt: new Date('2026-08-01T00:00:00Z') }),
  makeLeg({ id: 'B', bookingId: 'b2', state: 'AT_WAREHOUSE' }),
  makeLeg({ id: 'P', bookingId: 'b2', reviewStatus: 'provisional' }),
  makeLeg({ id: 'C', bookingId: 'b2', legStatus: 'CANCELLED' }),
  makeLeg({ id: 'D', bookingId: 'b2', kind: 'DOCUMENT' }),
  makeLeg({ id: 'N', bookingId: 'b3', state: 'AT_WAREHOUSE' }), // no shipment_pos rows → booking-level fallback
]

const SHIP_LINKS = [
  poRow('A', 'po1', '271018571', { legQty: 3000, legQtyUnit: 'cartons' }),
  poRow('B', 'po1', '271018571', { legQty: 2000, legQtyUnit: 'cartons' }),
  poRow('A', 'po2', '999888777', { legQty: 1000, inferred: true }),
  poRow('P', 'po3', '333222111'),
  poRow('C', 'po4', '444333222'),
  poRow('D', 'po5', '888777666'),
]

const BOOKING_LINKS = [{ ...poRow('', 'po6', '555000111'), bookingId: 'b3' }]

const BOOKINGS = new Map(
  Object.entries({
    b1: { id: 'b1', jobNo: 'S26001', customerId: 'c1', vendorId: 'v1' },
    b2: { id: 'b2', jobNo: 'S26002', customerId: 'c1', vendorId: null },
    b3: { id: 'b3', jobNo: 'S26003', customerId: null, vendorId: null },
  }),
)

function makeService(calls: { bookingFallbackIds?: string[][] } = {}) {
  const shipmentRepo = {
    activeLegs: async () => LEGS,
    exportPoLinksForShipments: async (ids: string[]) => SHIP_LINKS.filter((r) => ids.includes(r.shipmentId)),
    exportPoLinksForBookings: async (ids: string[]) => {
      calls.bookingFallbackIds?.push(ids)
      return BOOKING_LINKS.filter((r) => ids.includes(r.bookingId))
    },
    milestonesForShipments: async (ids: string[]) =>
      new Map(
        ids.includes('A')
          ? [['A', [{ shipmentId: 'A', milestoneType: 'BOOKING_SENT', occurredAt: new Date('2026-07-10T01:12:00Z') }]]]
          : [],
      ),
  } as unknown as ShipmentRepository
  const bookingRepo = {
    findByIds: async (ids: string[]) => new Map([...BOOKINGS].filter(([id]) => ids.includes(id))),
  } as unknown as BookingRepository
  const mastersRepo = {
    listCustomers: async () => [{ id: 'c1', code: 'SOUOCE', name: 'Source International Ltd' }],
    listVendors: async () => [{ id: 'v1', code: 'HONCOS', name: 'Hongyuan Costume Co Ltd' }],
    listForwarders: async () => [{ id: 'f1', code: 'LOGWIN', name: 'Logwin Air + Ocean' }],
    listCarriers: async () => [{ id: 'ca1', scac: 'COSU', name: 'COSCO Shipping' }],
    portsByIds: async (ids: string[]) =>
      [
        { id: 'p1', unlocode: 'CNSZX', iata: null, name: 'Shenzhen', country: 'China' },
        { id: 'p2', unlocode: 'USLGB', iata: null, name: 'Long Beach', country: 'United States' },
      ].filter((p) => ids.includes(p.id)),
  } as unknown as MastersRepository
  return new ErpExportService(shipmentRepo, bookingRepo, mastersRepo)
}

type Row = Record<string, unknown> & { shipments: Record<string, unknown>[] }
const numbers = (res: { pos: unknown[] }) => (res.pos as Row[]).map((p) => p.po_number)

describe('ErpExportService', () => {
  it('groups by PO with legs nested; resolves masters, carrier, ports, milestones', async () => {
    const calls = { bookingFallbackIds: [] as string[][] }
    const res = await makeService(calls).exportPos({})
    // gated: po3 (provisional), po4 (cancelled), po5 (DOCUMENT) are out
    expect(numbers(res)).toEqual(['271018571', '555000111', '999888777'])
    expect(res.total).toBe(3)
    expect(res.count).toBe(3)

    const po1 = (res.pos as Row[])[0]
    expect(po1.po_customer_code).toBe('SOUOCE')
    expect(po1.shipments).toHaveLength(2)
    const [sA, sB] = po1.shipments
    expect(sA.job_no).toBe('S26001')
    expect(sA.quantity_shipped).toBe(3000)
    expect(sB.job_no).toBe('S26002')
    expect(sB.quantity_shipped).toBe(2000)
    // identity always present + resolved reference data
    expect(sA.shipment_id).toBe('A')
    expect(sA.leg_no).toBe(1)
    expect(sA.status_label).toBe('DEPARTED')
    expect(sA.customer_code).toBe('SOUOCE')
    expect(sA.forwarder_code).toBe('LOGWIN')
    expect(sA.carrier_name).toBe('COSCO Shipping')
    expect(sA.pol_code).toBe('CNSZX')
    expect(sA.pol_name).toBe('Shenzhen')
    expect(sA.milestones).toEqual([
      { milestone_type: 'BOOKING_SENT', occurred_at: '2026-07-10T01:12:00.000Z' },
    ])

    // multi-PO leg: leg A appears under po2 as well, with its own split + inferred flag
    const po2 = (res.pos as Row[])[2]
    expect(po2.shipments).toHaveLength(1)
    expect(po2.shipments[0].quantity_shipped).toBe(1000)
    expect(po2.shipments[0].link_inferred).toBe(true)

    // legacy booking-level link: no per-leg quantity, honest labels; fallback queried only for b3
    const po6 = (res.pos as Row[])[1]
    expect(po6.shipments[0].link_level).toBe('booking')
    expect(po6.shipments[0].quantity_shipped).toBeNull()
    expect(po6.shipments[0].link_inferred).toBeNull()
    expect(calls.bookingFallbackIds).toEqual([['b3']])
  })

  it('fields= narrows output but identity fields stay', async () => {
    const res = await makeService().exportPos({ fields: 'eta,state' })
    expect(res.fields).toEqual(['po_number', 'shipment_id', 'job_no', 'leg_no', 'state', 'eta'])
    const po1 = (res.pos as Row[])[0]
    expect(Object.keys(po1).sort()).toEqual(['po_number', 'shipments'])
    expect(Object.keys(po1.shipments[0]).sort()).toEqual(['eta', 'job_no', 'leg_no', 'shipment_id', 'state'])
  })

  it('rejects unknown fields with a pointer to the catalog', async () => {
    await expect(makeService().exportPos({ fields: 'eta,nope' })).rejects.toThrow(BadRequestException)
    await expect(makeService().exportPos({ fields: 'eta,nope' })).rejects.toThrow(/unknown fields: nope/)
  })

  it('provisional legs are gated by default, included (and labeled) on request', async () => {
    const svc = makeService()
    expect(numbers(await svc.exportPos({}))).not.toContain('333222111')
    const res = await svc.exportPos({ includeProvisional: 'true' })
    const po3 = (res.pos as Row[]).find((p) => p.po_number === '333222111')!
    expect(po3.shipments[0].review_status).toBe('provisional')
  })

  it('cancelled legs are gated by default, included (and labeled) on request', async () => {
    const svc = makeService()
    expect(numbers(await svc.exportPos({}))).not.toContain('444333222')
    const res = await svc.exportPos({ includeCancelled: 'true' })
    const po4 = (res.pos as Row[]).find((p) => p.po_number === '444333222')!
    expect(po4.shipments[0].cancelled).toBe(true)
    expect(po4.shipments[0].status_label).toBe('CANCELLED')
  })

  it('DOCUMENT rows never export', async () => {
    const res = await makeService().exportPos({ includeProvisional: 'true', includeCancelled: 'true' })
    expect(numbers(res)).not.toContain('888777666')
  })

  it('poNumber lookup tolerates separators and case', async () => {
    const res = await makeService().exportPos({ poNumber: ' 271-018 571 ' })
    expect(numbers(res)).toEqual(['271018571'])
  })

  it('since keeps a PO when ANY leg moved, with the nested array complete', async () => {
    const res = await makeService().exportPos({ since: '2026-07-15T00:00:00Z' })
    // po1 via leg A (updated 08-01); po2 via leg A; po6's leg N is stale
    expect(numbers(res)).toEqual(['271018571', '999888777'])
    const po1 = (res.pos as Row[])[0]
    expect(po1.shipments).toHaveLength(2) // stale leg B still shown — full PO picture
  })

  it('state filters legs (and validates the value)', async () => {
    const res = await makeService().exportPos({ state: 'RELEASED' })
    expect(numbers(res)).toEqual(['271018571', '999888777'])
    expect((res.pos as Row[])[0].shipments).toHaveLength(1) // leg B (AT_WAREHOUSE) filtered out
    await expect(makeService().exportPos({ state: 'JUNK' })).rejects.toThrow(/invalid state/)
  })

  it('jobNo filters to one booking', async () => {
    const res = await makeService().exportPos({ jobNo: 's26002' })
    expect(numbers(res)).toEqual(['271018571'])
    expect((res.pos as Row[])[0].shipments).toHaveLength(1)
    expect((res.pos as Row[])[0].shipments[0].job_no).toBe('S26002')
  })

  it('paginates at the PO grain', async () => {
    const res = await makeService().exportPos({ limit: '1', offset: '1' })
    expect(res.total).toBe(3)
    expect(res.count).toBe(1)
    expect(numbers(res)).toEqual(['555000111'])
    await expect(makeService().exportPos({ limit: '0' })).rejects.toThrow(/invalid limit/)
    await expect(makeService().exportPos({ offset: '-1' })).rejects.toThrow(/invalid offset/)
  })

  it('lists the catalog with levels and always flags', () => {
    const { fields } = makeService().listFields()
    const poNumber = fields.find((f) => f.key === 'po_number')!
    expect(poNumber.level).toBe('po')
    expect(poNumber.always).toBe(true)
    expect(fields.some((f) => f.key === 'quantity_shipped' && f.level === 'shipment')).toBe(true)
  })
})
