import { describe, it, expect } from 'vitest'
import { deriveRoute, deriveOriginCountry, poNumbersJson, isoOrNull } from './derive'

describe('deriveRoute — POL/POD -> "POL→POD" string', () => {
  it('joins both ends with an arrow', () => {
    expect(deriveRoute('CNYTN', 'GBFXT')).toBe('CNYTN→GBFXT')
  })

  it('returns the single known end when the other is missing', () => {
    expect(deriveRoute('CNYTN', null)).toBe('CNYTN')
    expect(deriveRoute(null, 'GBFXT')).toBe('GBFXT')
  })

  it('returns null when neither end is known', () => {
    expect(deriveRoute(null, null)).toBeNull()
    expect(deriveRoute(undefined, undefined)).toBeNull()
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
