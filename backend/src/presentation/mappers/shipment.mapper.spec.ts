import { describe, it, expect } from 'vitest'
import { toUiShipment, type ShipmentMapperInput, type ShipmentLegRow } from './shipment.mapper'

const leg = (over: Partial<ShipmentLegRow> = {}): ShipmentLegRow => ({
  id: 'leg-1',
  forwarderId: 'fwd-1',
  state: 'SAILED',
  riskLevel: 'ON_TRACK',
  bookingNo: 'BK-100',
  soNo: 'SO-200',
  itemStyleNo: 'STY-9',
  consigneeName: 'ACME Importers',
  consigneeAddress: '1 Dock Rd',
  containerNo: 'MSKU1234567',
  mbl: 'MBL-555',
  hblAwbFcrNo: 'HBL-777',
  vesselName: 'EVER GLOBE',
  voyageNo: 'V42',
  scacCode: 'MAEU',
  originCountry: null,
  polRaw: null,
  podRaw: null,
  forwarderRaw: null,
  grossWeight: null,
  measurement: null,
  htsCode: null,
  cargoReadyDate: new Date('2026-02-01T00:00:00.000Z'),
  cfsCutoff: new Date('2026-02-03T00:00:00.000Z'),
  etd: new Date('2026-02-05T00:00:00.000Z'),
  eta: new Date('2026-02-20T00:00:00.000Z'),
  atd: new Date('2026-02-06T00:00:00.000Z'),
  ata: null,
  warehouseStartDate: null,
  warehouseEndDate: null,
  inDcDate: null,
  qty: 120,
  qtyUnit: 'cartons',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  ...over,
})

const fullInput = (): ShipmentMapperInput => ({
  leg: leg(),
  booking: { customerId: 'cust-1', vendorId: 'ven-1' },
  customer: { id: 'cust-1', name: 'Cole Haan', code: 'COLE' },
  vendor: { id: 'ven-1', name: 'Rose Knit', code: 'ROKNFT' },
  forwarder: { id: 'fwd-1', name: 'Fairate' },
  polPort: { unlocode: 'CNYTN', country: 'CN' },
  podPort: { unlocode: 'GBFXT', country: 'GB' },
  poNumbers: ['PO-1', 'PO-2', 'PO-1'],
  linkedPOs: [{ id: 'spo-1', poNumber: 'PO-1' }],
})

describe('toUiShipment — flat active-leg projection', () => {
  it('renames leg fields to the UI vocabulary', () => {
    const s = toUiShipment(fullInput())
    expect(s.id).toBe('leg-1')
    expect(s.soNumber).toBe('SO-200')
    expect(s.mblNumber).toBe('MBL-555')
    expect(s.hblNumber).toBe('HBL-777')
    expect(s.voyageNumber).toBe('V42')
    expect(s.quantityShipped).toBe(120)
    expect(s.quantityUnit).toBe('cartons')
    expect(s.bookingNo).toBe('BK-100')
    expect(s.containerNo).toBe('MSKU1234567')
    expect(s.vesselName).toBe('EVER GLOBE')
    expect(s.itemStyleNo).toBe('STY-9')
  })

  it('maps state -> UI status and passes risk through', () => {
    expect(toUiShipment(fullInput()).status).toBe('SAILED')
    expect(toUiShipment({ ...fullInput(), leg: leg({ state: 'RELEASED' }) }).status).toBe('DEPARTED')
    expect(toUiShipment(fullInput()).riskLevel).toBe('ON_TRACK')
  })

  it('AIR legs route by IATA airport code; sea legs keep the UN/LOCODE', () => {
    const air = toUiShipment({
      ...fullInput(),
      leg: leg({ mode: 'AIR' }),
      polPort: { unlocode: 'CNCAN', country: 'CN', iata: 'CAN' },
      podPort: { unlocode: 'NLAMS', country: 'NL', iata: 'AMS' },
    })
    expect(air.route).toBe('CAN→AMS')
    const sea = toUiShipment({
      ...fullInput(),
      leg: leg({ mode: 'SEA_LCL' }),
      polPort: { unlocode: 'KHPNH', country: 'KH', iata: 'PNH' },
      podPort: { unlocode: 'USLAX', country: 'US', iata: 'LAX' },
    })
    expect(sea.route).toBe('KHPNH→USLAX')
  })

  it('falls back to warehouse end date for CFS cut-off (parser vocab equates them); explicit value wins', () => {
    // no cfs_cutoff column value → display the warehouse end date (soul field 12: CFS cut-off ≡ 截仓时间)
    const fallback = toUiShipment({
      ...fullInput(),
      leg: leg({ cfsCutoff: null, warehouseEndDate: new Date('2026-06-30T00:00:00.000Z') }),
    })
    expect(fallback.cfsCutoff).toBe('2026-06-30T00:00:00.000Z')
    // an explicit (human-entered) cfs_cutoff still wins
    expect(toUiShipment(fullInput()).cfsCutoff).toBe('2026-02-03T00:00:00.000Z')
    // neither present → null, not a fabricated date
    expect(
      toUiShipment({ ...fullInput(), leg: leg({ cfsCutoff: null, warehouseEndDate: null }) }).cfsCutoff,
    ).toBeNull()
  })

  it('pulls customer/vendor from the parent booking and nests the master refs', () => {
    const s = toUiShipment(fullInput())
    expect(s.customerId).toBe('cust-1')
    expect(s.vendorId).toBe('ven-1')
    expect(s.forwarderId).toBe('fwd-1')
    expect(s.customer).toEqual({ id: 'cust-1', name: 'Cole Haan', code: 'COLE' })
    expect(s.vendor).toEqual({ id: 'ven-1', name: 'Rose Knit', code: 'ROKNFT' })
    expect(s.forwarder).toEqual({ id: 'fwd-1', name: 'Fairate' })
  })

  it('derives route, originCountry and poNumbers', () => {
    const s = toUiShipment(fullInput())
    expect(s.route).toBe('CNYTN→GBFXT')
    expect(s.originCountry).toBe('CN')
    expect(s.poNumbers).toBe('["PO-1","PO-2"]')
    expect(s.linkedPOs).toEqual([{ id: 'spo-1', poNumber: 'PO-1' }])
  })

  it('prefers the stored origin_country column over the derived POL country', () => {
    expect(toUiShipment({ ...fullInput(), leg: leg({ originCountry: 'BD' }) }).originCountry).toBe('BD')
  })

  it('serializes dates to ISO strings (and renames atd/ata, crd)', () => {
    const s = toUiShipment(fullInput())
    expect(s.etd).toBe('2026-02-05T00:00:00.000Z')
    expect(s.crd).toBe('2026-02-01T00:00:00.000Z')
    expect(s.actualDeparture).toBe('2026-02-06T00:00:00.000Z')
    expect(s.actualArrival).toBeNull()
    expect(s.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('exposes scacCode from the leg; warehouseAddress stays null (Phase 3)', () => {
    const s = toUiShipment(fullInput())
    expect(s.scacCode).toBe('MAEU')
    expect(s.warehouseAddress).toBeNull()
  })

  it('is null-safe: empty leg, no booking, no ports, no POs', () => {
    const s = toUiShipment({
      leg: leg({
        state: null, soNo: null, mbl: null, hblAwbFcrNo: null, voyageNo: null, qty: null,
        qtyUnit: null, etd: null, atd: null, cargoReadyDate: null, scacCode: null,
      }),
      booking: null,
    })
    expect(s.status).toBe('BOOKED')
    expect(s.scacCode).toBeNull()
    expect(s.customerId).toBeNull()
    expect(s.vendorId).toBeNull()
    expect(s.route).toBeNull()
    expect(s.originCountry).toBeNull()
    expect(s.poNumbers).toBe('[]')
    expect(s.linkedPOs).toEqual([])
    expect(s.customer).toBeNull()
    expect(s.soNumber).toBeNull()
    expect(s.etd).toBeNull()
  })
})
