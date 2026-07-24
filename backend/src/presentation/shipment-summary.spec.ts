import { describe, it, expect } from 'vitest'
import { buildShipmentSummary, mergePoNumbers } from './presentation.service'

describe('mergePoNumbers — booking_pos ∪ shipment_pos', () => {
  it('uses booking POs when present and unions shipment-side extras with stable first-seen order', () => {
    expect(mergePoNumbers(['PO-A', 'PO-B'], ['PO-B', 'PO-C'])).toEqual(['PO-A', 'PO-B', 'PO-C'])
  })

  it('falls back to shipment_pos when booking has none', () => {
    expect(mergePoNumbers([], ['LEG-PO-1', 'LEG-PO-2'])).toEqual(['LEG-PO-1', 'LEG-PO-2'])
  })

  it('dedupes case-insensitively and skips blanks', () => {
    expect(mergePoNumbers(['po-1', ''], ['PO-1', '  ', 'PO-2'])).toEqual(['po-1', 'PO-2'])
  })
})

const maps = {
  customers: new Map([['c1', { id: 'c1', code: 'COLE', name: 'Cole Haan' }]]),
  vendors: new Map(),
  forwarders: new Map(),
  ports: new Map([
    ['p1', { id: 'p1', unlocode: 'CNYTN', iata: null, country: 'CN' }],
    ['p2', { id: 'p2', unlocode: 'GBFXT', iata: null, country: 'GB' }],
  ]),
} as never

describe('buildShipmentSummary — pure per-shipment summary from preloaded rows + master maps', () => {
  it('maps id, deduped JSON PO numbers, sea route, customer, and consignee', () => {
    const s = buildShipmentSummary(
      { id: 'leg1', bookingId: 'b1', mode: 'SEA', polId: 'p1', podId: 'p2', consigneeName: '  Acme Consignee  ' },
      { customerId: 'c1' },
      ['PO-1', 'PO-1', 'PO-2'],
      maps,
    )
    expect(s).toEqual({
      id: 'leg1',
      poNumbers: '["PO-1","PO-2"]',
      route: 'CNYTN→GBFXT',
      customer: { name: 'Cole Haan' },
      consigneeName: 'Acme Consignee',
      // #350: Shipment ID anchor fields — null here (fixture leg carries no emails / createdAt)
      firstEmailAt: null,
      createdAt: null,
    })
  })

  it('AIR legs display the IATA code in the route; missing POD → "-" placeholder (#115); unknown customer/POs/consignee → null/[]', () => {
    const airMaps = {
      customers: new Map(),
      vendors: new Map(),
      forwarders: new Map(),
      ports: new Map([['p1', { id: 'p1', unlocode: 'CNCAN', iata: 'CAN', country: 'CN' }]]),
    } as never
    const s = buildShipmentSummary({ id: 'leg2', bookingId: 'b2', mode: 'AIR', polId: 'p1', podId: null }, null, [], airMaps)
    expect(s.route).toBe('CAN → -') // IATA code for the origin, placeholder for the absent destination
    expect(s.customer).toBeNull()
    expect(s.poNumbers).toBe('[]')
    expect(s.consigneeName).toBeNull()
  })

  it('blank consigneeName becomes null (no empty-string chrome for cards)', () => {
    const s = buildShipmentSummary(
      { id: 'leg3', bookingId: 'b1', mode: 'SEA', polId: 'p1', podId: 'p2', consigneeName: '   ' },
      { customerId: 'c1' },
      [],
      maps,
    )
    expect(s.consigneeName).toBeNull()
  })
})
