import { describe, it, expect } from 'vitest'
import { journeyRoute, deriveRoute, portLabel, deriveOriginCountry, poNumbersJson, isoOrNull } from './derive'

describe('deriveRoute — POL/POD -> "POL→POD", both sides always shown (#115)', () => {
  it('joins both ends with an arrow (unchanged)', () => {
    expect(deriveRoute('CNYTN', 'GBFXT')).toBe('CNYTN→GBFXT')
  })

  it('renders the known end + a "-" placeholder for the missing one (not the lone code)', () => {
    expect(deriveRoute('CNYTN', null)).toBe('CNYTN → -')
    expect(deriveRoute('CNYTN', undefined)).toBe('CNYTN → -')
    expect(deriveRoute(null, 'GBFXT')).toBe('- → GBFXT')
    expect(deriveRoute(undefined, 'GBFXT')).toBe('- → GBFXT')
  })

  it('returns null when neither end is known (frontend renders the "—" dash)', () => {
    expect(deriveRoute(null, null)).toBeNull()
    expect(deriveRoute(undefined, undefined)).toBeNull()
  })
})

describe('portLabel — AIR legs display IATA airport codes, sea legs UN/LOCODE', () => {
  it('an AIR leg shows the IATA code (CNCAN → CAN)', () => {
    expect(portLabel('AIR', 'CNCAN', 'CAN')).toBe('CAN')
    expect(portLabel('AIR', 'NLAMS', 'AMS')).toBe('AMS')
  })

  it('sea modes keep the UN/LOCODE even when the port has an IATA code', () => {
    expect(portLabel('SEA', 'KHPNH', 'PNH')).toBe('KHPNH')
    expect(portLabel('SEA', 'USLAX', 'LAX')).toBe('USLAX')
    expect(portLabel(null, 'CNYTN', null)).toBe('CNYTN')
  })

  it('an AIR leg without a known IATA code falls back to the UN/LOCODE', () => {
    expect(portLabel('AIR', 'CNYTN', null)).toBe('CNYTN')
  })

  it('propagates missing codes as null', () => {
    expect(portLabel('AIR', null, null)).toBeNull()
  })

  it('composes with deriveRoute for the air route John flagged', () => {
    expect(deriveRoute(portLabel('AIR', 'CNCAN', 'CAN'), portLabel('AIR', 'NLAMS', 'AMS'))).toBe('CAN→AMS')
  })
})

describe('deriveOriginCountry — POL port country', () => {
  it('reads the country off the POL port', () => {
    expect(deriveOriginCountry({ country: 'CN' })).toBe('CN')
  })

  it('returns null when port or country is absent', () => {
    expect(deriveOriginCountry({ country: null })).toBeNull()
    expect(deriveOriginCountry(null)).toBeNull()
    expect(deriveOriginCountry(undefined)).toBeNull()
  })
})

describe('poNumbersJson — PO numbers -> JSON string array', () => {
  it('stringifies an array of PO numbers', () => {
    expect(poNumbersJson(['PO1', 'PO2'])).toBe('["PO1","PO2"]')
  })

  it('returns "[]" for no PO numbers', () => {
    expect(poNumbersJson([])).toBe('[]')
  })

  it('dedupes and drops empties while preserving first-seen order', () => {
    expect(poNumbersJson(['PO1', 'PO1', '', null, undefined, 'PO2'])).toBe('["PO1","PO2"]')
  })
})

describe('isoOrNull — date -> ISO string for the UI', () => {
  it('serializes a Date to an ISO string', () => {
    expect(isoOrNull(new Date('2026-02-01T00:00:00.000Z'))).toBe('2026-02-01T00:00:00.000Z')
  })

  it('passes an existing string through', () => {
    expect(isoOrNull('2026-02-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z')
  })

  it('returns null for null/undefined', () => {
    expect(isoOrNull(null)).toBeNull()
    expect(isoOrNull(undefined)).toBeNull()
  })
})

describe('journeyRoute — the chain wins the route string', () => {
  const DEL = JSON.stringify([
    { seq: 1, mode: 'Air', pol: 'PVG', pod: 'DEL', doc: '098-32230085' },
    { seq: 2, mode: 'Air', pol: 'DEL', pod: 'LHR', doc: null },
  ])

  it('renders every stop of a stored chain', () => {
    expect(journeyRoute(DEL)).toBe('PVG→DEL→LHR')
  })

  it('renders a four-stop sea relay', () => {
    const relay = JSON.stringify([
      { seq: 1, mode: 'Sea', pol: 'PNH', pod: 'VUT', doc: null },
      { seq: 2, mode: 'Sea', pol: 'VUT', pod: 'TPP', doc: null },
      { seq: 3, mode: 'Sea', pol: 'TPP', pod: 'LGP', doc: null },
    ])
    expect(journeyRoute(relay)).toBe('PNH→VUT→TPP→LGP')
  })

  it('🔴 accepts the ALREADY-PARSED array the kysely JSON plugin actually hands back', () => {
    // The integration test read null from a real row while the string-in unit case was green: the
    // column is nvarchar JSON but arrives pre-parsed. Fourth sighting of the wire-type trap.
    expect(journeyRoute([
      { seq: 1, mode: 'Air', pol: 'PVG', pod: 'DEL', doc: null },
      { seq: 2, mode: 'Air', pol: 'DEL', pod: 'LHR', doc: null },
    ])).toBe('PVG→DEL→LHR')
  })

  it('null on absent, malformed, or sub-chain input — every caller falls back to deriveRoute', () => {
    expect(journeyRoute(null)).toBeNull()
    expect(journeyRoute(undefined)).toBeNull()
    expect(journeyRoute('not json')).toBeNull()
    expect(journeyRoute('{}')).toBeNull()
    expect(journeyRoute(JSON.stringify([{ pol: 'PVG', pod: 'LHR' }]))).toBeNull() // one leg = endpoints only
  })
})
