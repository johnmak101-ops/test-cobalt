import { describe, it, expect } from 'vitest'
import { buildShipmentSummary } from './presentation.service'

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
