import { describe, it, expect } from 'vitest'
import { parsePONumbers, formatPoHeader } from './utils'

describe('parsePONumbers — the guard TopBar/AlertCard/etc. rely on', () => {
  it('parses a JSON array of PO numbers', () => {
    expect(parsePONumbers('["PO-1","PO-2"]')).toEqual(['PO-1', 'PO-2'])
  })
  it('falls back to the raw string when the value is not JSON (never throws)', () => {
    expect(parsePONumbers('PO-1')).toEqual(['PO-1'])
  })
})

describe('formatPoHeader — alert card multi-PO chrome', () => {
  it('returns null for empty (caller omits the span)', () => {
    expect(formatPoHeader([])).toBeNull()
  })
  it('formats a single PO', () => {
    expect(formatPoHeader(['100-100209'])).toBe('PO# 100-100209')
  })
  it('formats multi as first +N extras', () => {
    expect(formatPoHeader(['A', 'B', 'C'])).toBe('PO# A +2')
  })
})
