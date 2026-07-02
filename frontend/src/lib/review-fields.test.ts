import { describe, it, expect } from 'vitest'
import {
  EDITABLE_FIELDS,
  buildCorrections,
  conflictColumns,
  toInputValue,
} from './review-fields'

describe('EDITABLE_FIELDS', () => {
  it('maps every UI key to a leg column with a type', () => {
    const qty = EDITABLE_FIELDS.find((f) => f.uiKey === 'quantityShipped')
    expect(qty).toMatchObject({ column: 'qty', type: 'number' })
    const hbl = EDITABLE_FIELDS.find((f) => f.uiKey === 'hblNumber')
    expect(hbl).toMatchObject({ column: 'hblAwbFcrNo', type: 'text' })
    const atd = EDITABLE_FIELDS.find((f) => f.uiKey === 'actualDeparture')
    expect(atd).toMatchObject({ column: 'atd', type: 'date' })
  })
})

describe('buildCorrections — dirty-diff keyed by leg column', () => {
  const original = {
    bookingNo: 'BX123',
    quantityShipped: 5,
    grossWeight: 7,
    etd: '2026-07-10T00:00:00.000Z',
    consigneeName: null,
  }

  it('returns only changed fields, keyed by column name', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '8', grossWeight: '7', etd: '2026-07-10', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ qty: '8' })
  })

  it('treats clearing a value as a change to empty (backend coerces to null)', () => {
    const edited = { bookingNo: '', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ bookingNo: '' })
  })

  it('date compares on the yyyy-MM-dd part, not the ISO timestamp', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-12', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ etd: '2026-07-12' })
  })

  it('returns {} when nothing changed', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({})
  })
})

describe('conflictColumns — parse "why review?" reasons into column names', () => {
  it('extracts snake_case field tokens and maps to leg columns', () => {
    const cols = conflictColumns(['backend conflict on qty, gross_weight, measurement'])
    expect(cols).toContain('qty')
    expect(cols).toContain('grossWeight')
    expect(cols).toContain('measurement')
  })

  it('ignores reasons that name no known fields', () => {
    expect(conflictColumns(['matched multiple backend legs (ambiguous)'])).toEqual([])
    expect(conflictColumns(['5 unresolved field conflict(s)'])).toEqual([])
  })
})

describe('toInputValue — shipment value → input value', () => {
  it('slices ISO dates to yyyy-MM-dd for date inputs', () => {
    expect(toInputValue('2026-07-10T00:00:00.000Z', 'date')).toBe('2026-07-10')
  })
  it('renders null as empty string', () => {
    expect(toInputValue(null, 'text')).toBe('')
    expect(toInputValue(null, 'number')).toBe('')
  })
  it('stringifies numbers', () => {
    expect(toInputValue(7.5, 'number')).toBe('7.5')
  })
})
