import { describe, it, expect } from 'vitest'
import { formatShortDate, formatRelativeTime, parsePONumbers, cn, modeLabel, stateLabel, titleCase } from './utils'

describe('utils', () => {
  it('formatShortDate renders day + month, TBD for empty', () => {
    expect(formatShortDate('2026-02-10')).toMatch(/10.*Feb/)
    expect(formatShortDate(null)).toBe('TBD')
  })

  it('formatRelativeTime buckets recent times', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 2 * 3600_000)).toBe('2h ago')
    expect(formatRelativeTime(now - 30_000)).toBe('Just now')
    expect(formatRelativeTime(now - 5 * 60_000)).toBe('5m ago')
  })

  it('parsePONumbers parses a JSON array, falls back to a single value', () => {
    expect(parsePONumbers('["PO-1","PO-2"]')).toEqual(['PO-1', 'PO-2'])
    expect(parsePONumbers('PO-9')).toEqual(['PO-9'])
  })

  it('cn joins truthy class names', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c')
  })
})

describe('labels', () => {
  it('modeLabel humanizes shipment modes', () => {
    expect(modeLabel('SEA_LCL')).toBe('Sea (LCL)')
    expect(modeLabel('AIR')).toBe('Air')
    expect(modeLabel(null)).toBe('—')
  })

  it('stateLabel uses the staircase names; the 4th state is the uniform "Departed"', () => {
    expect(stateLabel('AT_WAREHOUSE')).toBe('At Warehouse')
    expect(stateLabel('CONFIRMED')).toBe('Confirmed')
    expect(stateLabel('SAILED')).toBe('Departed')
  })

  it('titleCase normalizes single-word enums', () => {
    expect(titleCase('ACTIVE')).toBe('Active')
    expect(titleCase('SUPERSEDED')).toBe('Superseded')
  })
})
