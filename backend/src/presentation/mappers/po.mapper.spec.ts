import { describe, it, expect } from 'vitest'
import { toUiPurchaseOrder, toUiPurchaseOrderDetail, type PoRow, type PoMapperInput } from './po.mapper'
import type { ShipmentMapperInput, ShipmentLegRow } from './shipment.mapper'

const po = (over: Partial<PoRow> = {}): PoRow => ({
  id: 'po-1',
  poNumber: '100-100209',
  customerId: 'cust-1',
  vendorId: 'ven-1',
  totalQuantity: 500,
  quantityUnit: 'cartons',
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...over,
})

const input = (over: Partial<PoMapperInput> = {}): PoMapperInput => ({
  po: po(),
  customer: { id: 'cust-1', name: 'Cole Haan', code: 'COLE' },
  vendor: { id: 'ven-1', name: 'Rose Knit', code: 'ROKNFT' },
  shipmentCount: 2,
  shippedQuantity: 300,
  shipmentSummary: [{ id: 'leg-1', status: 'SAILED' }],
  ...over,
})

const legInput = (): ShipmentMapperInput => ({
  leg: { id: 'leg-1', state: 'SAILED', forwarderId: null, riskLevel: 'ON_TRACK' } as ShipmentLegRow,
  booking: { customerId: 'cust-1', vendorId: 'ven-1' },
  poNumbers: ['100-100209'],
})

describe('toUiPurchaseOrder — PO + aggregates -> UI shape', () => {
  it('maps core fields, nests masters, serializes dates', () => {
    const p = toUiPurchaseOrder(input())
    expect(p.id).toBe('po-1')
    expect(p.poNumber).toBe('100-100209')
    expect(p.customerId).toBe('cust-1')
    expect(p.vendorId).toBe('ven-1')
    expect(p.totalQuantity).toBe(500)
    expect(p.quantityUnit).toBe('cartons')
    expect(p.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(p.customer).toEqual({ id: 'cust-1', name: 'Cole Haan', code: 'COLE' })
    expect(p.vendor).toEqual({ id: 'ven-1', name: 'Rose Knit', code: 'ROKNFT' })
  })

  it('passes the fulfilment aggregates through', () => {
    const p = toUiPurchaseOrder(input())
    expect(p.shipmentCount).toBe(2)
    expect(p.shippedQuantity).toBe(300)
    expect(p.shipmentSummary).toEqual([{ id: 'leg-1', status: 'SAILED' }])
  })

  it('passes notes through from the PO row (null when absent)', () => {
    expect(toUiPurchaseOrder(input()).notes).toBeNull()
    expect(toUiPurchaseOrder({ ...input(), po: po({ notes: 'rush order' }) }).notes).toBe('rush order')
  })

  it('is null-safe: no masters, no aggregates', () => {
    const p = toUiPurchaseOrder({ po: po({ totalQuantity: null, quantityUnit: null }) })
    expect(p.customer).toBeNull()
    expect(p.vendor).toBeNull()
    expect(p.shipmentCount).toBe(0)
    expect(p.shippedQuantity).toBeNull()
    expect(p.shipmentSummary).toEqual([])
    expect(p.totalQuantity).toBeNull()
  })
})

describe('toUiPurchaseOrderDetail — adds full linked shipments', () => {
  it('maps each linked shipment to the full UI shipment shape + linkedQuantity', () => {
    const d = toUiPurchaseOrderDetail({
      ...input(),
      linkedShipments: [
        { shipment: legInput(), linkedQuantity: 120, linkId: 'spo-1', linkedAt: new Date('2026-03-01T00:00:00.000Z') },
      ],
    })
    expect(d.poNumber).toBe('100-100209')
    expect(d.linkedShipments).toHaveLength(1)
    const ls = d.linkedShipments[0]
    expect(ls.id).toBe('leg-1')
    expect(ls.status).toBe('SAILED') // proves the full shipment mapper ran
    expect(ls.poNumbers).toBe('["100-100209"]')
    expect(ls.linkedQuantity).toBe(120)
    // linkId + linkedAt must survive — the UI unlink action DELETEs by linkId
    expect(ls.linkId).toBe('spo-1')
    expect(ls.linkedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('defaults linkedShipments to [] when none provided', () => {
    expect(toUiPurchaseOrderDetail(input()).linkedShipments).toEqual([])
  })
})
