import { describe, it, expect } from 'vitest'
import { legLooksLikeShipment, hasUsableIdentifier, hasShipmentSubstance } from './leg-shape'

describe('legLooksLikeShipment — which shape the review card takes', () => {
  const realLeg = {
    bookingNo: 'FENLSO003044',
    route: 'CNYTN→CAN',
    etd: '2026-02-08T00:00:00.000Z',
  }

  it('a leg with an identifier, a route and a schedule is a shipment', () => {
    expect(legLooksLikeShipment(realLeg)).toBe(true)
  })

  /**
   * The whole point: this leg gets "Which values are correct?" and Edit / Keep current / Apply —
   * never "Is this a real shipment?" and never a reject button.
   */
  it('accepts any one substance signal alongside the identifier', () => {
    expect(legLooksLikeShipment({ bookingNo: 'BY058417', route: 'CNYTN→GBFXT' })).toBe(true)
    expect(legLooksLikeShipment({ soNumber: 'FENLSO003044', etd: '2026-02-08' })).toBe(true)
    expect(legLooksLikeShipment({ hblNumber: 'SE26061400005', vesselName: 'MARIBO MAERSK' })).toBe(true)
    expect(legLooksLikeShipment({ mawb: '160-12345675', flightNo: 'CX880' })).toBe(true)
    // cargo counts as substance, via the leg or its POs
    expect(legLooksLikeShipment({ bookingNo: 'BY058417', qty: 784 })).toBe(true)
    expect(
      legLooksLikeShipment({ bookingNo: 'BY058417' }, [{ poNumber: '28631', quantity: 600 }]),
    ).toBe(true)
  })

  it('a spreadsheet header is not an identifier, so the leg is not a shipment', () => {
    // The same digit test that catches `PO # :` / `SO no.` / `PORT OF LOADING`.
    expect(hasUsableIdentifier({ bookingNo: 'PO # :' })).toBe(false)
    expect(hasUsableIdentifier({ soNumber: 'PORT OF LOADING' })).toBe(false)
    expect(legLooksLikeShipment({ bookingNo: 'PO # :', route: 'CAN', etd: '2026-02-08' })).toBe(false)
  })

  it('needs BOTH halves — one alone is exactly the ambiguous case', () => {
    // an identity with nothing moving
    expect(legLooksLikeShipment({ bookingNo: 'FENLSO003044' })).toBe(false)
    // a route with nothing to file it under
    expect(legLooksLikeShipment({ route: 'CNYTN→CAN', etd: '2026-02-08' })).toBe(false)
  })

  it('thin mail is not a shipment', () => {
    expect(legLooksLikeShipment({})).toBe(false)
    expect(legLooksLikeShipment(null)).toBe(false)
    expect(legLooksLikeShipment(undefined)).toBe(false)
  })

  it('a PO alone does not make it one', () => {
    expect(legLooksLikeShipment({}, [{ poNumber: '28631', quantity: 600 }])).toBe(false)
  })

  it('ignores blank and zero values', () => {
    expect(hasUsableIdentifier({ bookingNo: '   ' })).toBe(false)
    expect(hasShipmentSubstance({ route: '  ', qty: 0 }, [{ poNumber: 'x', quantity: 0 }])).toBe(false)
  })

  it('reads queue-row and detail spellings alike', () => {
    // queue rows carry soNo / detail carries soNumber; both must resolve
    expect(hasUsableIdentifier({ soNo: 'FENLSO003044' })).toBe(true)
    expect(hasUsableIdentifier({ soNumber: 'FENLSO003044' })).toBe(true)
    expect(hasShipmentSubstance({ actualDeparture: '2026-02-11' })).toBe(true)
    expect(hasShipmentSubstance({ cargoReadyDate: '2026-02-01' })).toBe(true)
  })
})
