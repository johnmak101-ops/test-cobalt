import { describe, it, expect } from 'vitest'
import {
  EDITABLE_FIELDS,
  buildCorrections,
  conflictColumns,
  toInputValue,
  parseStyleEntries,
  serializeStyleEntries,
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
  // constructed in LOCAL time on purpose — datetime-local inputs are local wall-clock
  const original = {
    bookingNo: 'BX123',
    quantityShipped: 5,
    grossWeight: 7,
    etd: new Date(2026, 6, 10, 0, 0),
    consigneeName: null,
  }

  it('returns only changed fields, keyed by column name', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '8', grossWeight: '7', etd: '2026-07-10T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ qty: '8' })
  })

  it('treats clearing a value as a change to empty (backend coerces to null)', () => {
    const edited = { bookingNo: '', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ bookingNo: '' })
  })

  it('a date change is detected, and a TIME-only change counts too (cut-off times matter)', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-12T00:00', consigneeName: '' }
    expect(buildCorrections(original, edited)).toEqual({ etd: '2026-07-12T00:00' })
    const timeOnly = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10T15:00', consigneeName: '' }
    expect(buildCorrections(original, timeOnly)).toEqual({ etd: '2026-07-10T15:00' })
  })

  it('returns {} when nothing changed', () => {
    const edited = { bookingNo: 'BX123', quantityShipped: '5', grossWeight: '7', etd: '2026-07-10T00:00', consigneeName: '' }
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
  it('renders dates as LOCAL datetime-local so a stated cut-off time survives editing', () => {
    expect(toInputValue(new Date(2026, 5, 29, 15, 0), 'date')).toBe('2026-06-29T15:00')
    expect(toInputValue(new Date(2026, 6, 10, 0, 0), 'date')).toBe('2026-07-10T00:00')
  })
  it('renders null as empty string', () => {
    expect(toInputValue(null, 'text')).toBe('')
    expect(toInputValue(null, 'number')).toBe('')
  })
  it('stringifies numbers', () => {
    expect(toInputValue(7.5, 'number')).toBe('7.5')
  })
})

describe('style entries table — parse/serialize round trip', () => {
  it('splits PO/style pairs and bare styles into rows', () => {
    expect(parseStyleEntries('4483262/LKN18360L15, LKN1794, 655000/564399')).toEqual([
      { po: '4483262', style: 'LKN18360L15' },
      { po: '', style: 'LKN1794' },
      { po: '655000', style: '564399' },
    ])
  })

  it('serializes rows back, dropping empties', () => {
    expect(
      serializeStyleEntries([
        { po: '4483262', style: 'LKN18360L15' },
        { po: '', style: 'LKN1794' },
        { po: '', style: '' },
        { po: '655025', style: '' },
      ]),
    ).toBe('4483262/LKN18360L15, LKN1794, 655025')
  })

  it('round-trips a real list unchanged', () => {
    const s = '56571/SS26SW022, 56572/SS26SW023'
    expect(serializeStyleEntries(parseStyleEntries(s))).toBe(s)
  })

  it('handles null/empty', () => {
    expect(parseStyleEntries(null)).toEqual([])
    expect(serializeStyleEntries([])).toBe('')
  })
})
