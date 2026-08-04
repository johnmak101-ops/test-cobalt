import { describe, it, expect } from 'vitest'
import {
  ERP_EXPORT_FIELDS,
  FIELD_BY_KEY,
  resolveSelection,
  type ExportPoCtx,
  type ExportShipmentCtx,
} from './field-catalog'

const fullPoCtx: ExportPoCtx = {
  poNumber: '271018571',
  brand: "Levi's",
  itemStyleNo: 'A5722-0001',
  totalQuantity: 5000,
  quantityUnit: 'cartons',
  crd: new Date('2026-07-15T00:00:00Z'),
  customerCode: 'SOUOCE',
  customerName: 'Source International Ltd',
  vendorCode: 'HONCOS',
  vendorName: 'Hongyuan Costume Co Ltd',
}

const fullShipCtx: ExportShipmentCtx = {
  leg: {
    id: 'leg-1',
    legNo: 1,
    state: 'RELEASED',
    legStatus: 'ACTIVE',
    reviewStatus: 'confirmed',
    riskLevel: 'ON_TRACK',
    mode: 'SEA',
    journey: null,
    bookingNo: '271018571',
    soNo: 'SO88123',
    warehouseSo: null,
    hblAwbFcrNo: 'SZXLH2607123',
    mbl: 'COSU633899120',
    mawb: null,
    containerNo: 'OOCU7788991',
    vesselName: 'OOCL SPAIN',
    voyageNo: '058W',
    flightNo: null,
    scacCode: 'COSU',
    polRaw: 'SHENZHEN',
    podRaw: 'LONG BEACH',
    originCountry: 'China',
    cargoReadyDate: new Date('2026-07-15T00:00:00Z'),
    cfsCutoff: null,
    warehouseStartDate: new Date('2026-07-20T00:00:00Z'),
    warehouseEndDate: new Date('2026-07-24T00:00:00Z'),
    etd: new Date('2026-07-28T00:00:00Z'),
    atd: new Date('2026-07-28T00:00:00Z'),
    eta: new Date('2026-08-12T00:00:00Z'),
    ata: null,
    inDcDate: null,
    qty: 5000,
    qtyUnit: 'cartons',
    cartons: 5000,
    grossWeight: 8667.68,
    netWeight: 7912.4,
    measurement: 58.2,
    cargoDescription: "Men's knitted pullover",
    htsCode: '6110.20',
    itemStyleNo: 'A5722-0001',
    customerRaw: 'SOURCE INTL',
    vendorRaw: '宏源制衣',
    forwarderRaw: 'LOGWIN AIR OCEAN HK',
    consigneeName: 'Source Intl (US) Inc',
    consigneeAddress: '100 Harbor Blvd, Long Beach CA',
    createdAt: new Date('2026-07-10T01:15:00Z'),
    updatedAt: new Date('2026-07-29T03:05:00Z'),
  },
  jobNo: 'S2600144827',
  customer: { code: 'SOUOCE', name: 'Source International Ltd' },
  vendor: { code: 'HONCOS', name: 'Hongyuan Costume Co Ltd' },
  forwarder: { code: 'LOGWIN', name: 'Logwin Air + Ocean' },
  polPort: { unlocode: 'CNSZX', iata: null, name: 'Shenzhen', country: 'China' },
  podPort: { unlocode: 'USLGB', iata: null, name: 'Long Beach', country: 'United States' },
  carrierName: 'COSCO Shipping',
  link: { quantity: 3000, quantityUnit: 'cartons', inferred: false, level: 'shipment' },
  milestones: [
    { milestoneType: 'BOOKING_SENT', occurredAt: new Date('2026-07-10T01:12:00Z') },
    { milestoneType: 'FINAL_BL_RECEIVED', occurredAt: new Date('2026-07-29T03:03:00Z') },
  ],
}

const extractAll = () => {
  const out: Record<string, unknown> = {}
  for (const f of ERP_EXPORT_FIELDS) {
    out[f.key] = f.level === 'po' ? f.extract(fullPoCtx) : f.extract(fullShipCtx)
  }
  return out
}

describe('ERP export field catalog', () => {
  it('keys are unique and snake_case', () => {
    const keys = ERP_EXPORT_FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*$/)
  })

  it('identity fields are exactly the always-on set', () => {
    const always = ERP_EXPORT_FIELDS.filter((f) => f.always).map((f) => f.key)
    expect(always.sort()).toEqual(['job_no', 'leg_no', 'po_number', 'shipment_id'])
  })

  it('pipeline-internal data is not exportable', () => {
    for (const k of FIELD_BY_KEY.keys()) {
      expect(k).not.toMatch(/critic|review_reason|committer|match_key|confidence/)
    }
  })

  it('every extractor runs against a fully-populated context without throwing', () => {
    const out = extractAll()
    expect(Object.keys(out).length).toBe(ERP_EXPORT_FIELDS.length)
  })

  it('status_label uses the business vocabulary (RELEASED→DEPARTED; CANCELLED overrides)', () => {
    const f = FIELD_BY_KEY.get('status_label')!
    expect(f.level).toBe('shipment')
    const s = f as Extract<typeof f, { level: 'shipment' }>
    expect(s.extract(fullShipCtx)).toBe('DEPARTED')
    expect(
      s.extract({ ...fullShipCtx, leg: { ...fullShipCtx.leg, legStatus: 'CANCELLED' } }),
    ).toBe('CANCELLED')
  })

  it('route prefers the journey chain, falls back to resolved port codes', () => {
    const s = FIELD_BY_KEY.get('route') as Extract<(typeof ERP_EXPORT_FIELDS)[number], { level: 'shipment' }>
    expect(s.extract(fullShipCtx)).toBe('CNSZX→USLGB')
    const withJourney = {
      ...fullShipCtx,
      leg: { ...fullShipCtx.leg, journey: [{ seq: 1, pol: 'PVG', pod: 'DEL' }, { seq: 2, pol: 'DEL', pod: 'LHR' }] },
    }
    expect(s.extract(withJourney)).toBe('PVG→DEL→LHR')
  })

  it('air legs show IATA port codes', () => {
    const s = FIELD_BY_KEY.get('pol_code') as Extract<(typeof ERP_EXPORT_FIELDS)[number], { level: 'shipment' }>
    const air = {
      ...fullShipCtx,
      leg: { ...fullShipCtx.leg, mode: 'AIR' },
      polPort: { unlocode: 'CNCAN', iata: 'CAN', name: 'Guangzhou', country: 'China' },
    }
    expect(s.extract(air)).toBe('CAN')
    expect(s.extract(fullShipCtx)).toBe('CNSZX')
  })

  it('dates serialize to ISO strings; milestones map to snake_case rows', () => {
    const out = extractAll()
    expect(out.etd).toBe('2026-07-28T00:00:00.000Z')
    expect(out.ata).toBeNull()
    expect(out.milestones).toEqual([
      { milestone_type: 'BOOKING_SENT', occurred_at: '2026-07-10T01:12:00.000Z' },
      { milestone_type: 'FINAL_BL_RECEIVED', occurred_at: '2026-07-29T03:03:00.000Z' },
    ])
  })

  it('cfs_cutoff is the raw column — no warehouse_end display fallback', () => {
    const out = extractAll()
    expect(out.cfs_cutoff).toBeNull()
    expect(out.warehouse_end_date).toBe('2026-07-24T00:00:00.000Z')
  })

  it('per-PO link fields: quantity_shipped is the split, link_inferred null at booking level', () => {
    const out = extractAll()
    expect(out.quantity_shipped).toBe(3000)
    expect(out.shipment_total_qty).toBe(5000)
    const inferred = FIELD_BY_KEY.get('link_inferred') as Extract<(typeof ERP_EXPORT_FIELDS)[number], { level: 'shipment' }>
    expect(
      inferred.extract({
        ...fullShipCtx,
        link: { quantity: null, quantityUnit: null, inferred: null, level: 'booking' },
      }),
    ).toBeNull()
  })

  describe('resolveSelection', () => {
    it('no request → full catalog', () => {
      expect(resolveSelection(null).fields).toBe(ERP_EXPORT_FIELDS)
      expect(resolveSelection([]).fields).toBe(ERP_EXPORT_FIELDS)
    })

    it('subset keeps catalog order and merges identity in', () => {
      const { fields, unknown } = resolveSelection(['eta', 'state'])
      expect(unknown).toEqual([])
      expect(fields.map((f) => f.key)).toEqual([
        'po_number',
        'shipment_id',
        'job_no',
        'leg_no',
        'state',
        'eta',
      ])
    })

    it('reports unknown keys instead of dropping them silently', () => {
      const { unknown } = resolveSelection(['eta', 'nope', 'also_nope'])
      expect(unknown).toEqual(['nope', 'also_nope'])
    })
  })
})
