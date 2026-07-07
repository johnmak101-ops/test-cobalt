import { describe, it, expect } from 'vitest'
import { parsePONumbers } from './utils'

describe('parsePONumbers — the guard TopBar/AlertCard/etc. rely on', () => {
  it('parses a JSON array of PO numbers', () => {
    expect(parsePONumbers('["PO-1","PO-2"]')).toEqual(['PO-1', 'PO-2'])
  })
  it('falls back to the raw string when the value is not JSON (never throws)', () => {
    expect(parsePONumbers('PO-1')).toEqual(['PO-1'])
  })
})
