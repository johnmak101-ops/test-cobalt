import { describe, it, expect } from 'vitest'
import {
  canonicalFieldKey,
  historyCategoryOf,
  groupHistoryByCategory,
  indexHistoryByField,
  historyForField,
} from './history-grouping'
import type { HistoryEntry } from '../hooks/use-shipment-history'

function entry(field: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `${field}-${over.changedAt ?? '1'}`,
    shipmentId: 's1',
    field,
    oldValue: null,
    newValue: 'x',
    sourceType: 'manual',
    sourceId: null,
    changedBy: null,
    isDelay: false,
    notes: null,
    changedAt: '2026-07-18T00:00:00.000Z',
    ...over,
  }
}

describe('canonicalFieldKey — folds field-key drift to one leg column', () => {
  it('maps legacy/resolved/raw aliases to the leg column', () => {
    expect(canonicalFieldKey('quantity_shipped')).toBe('qty')
    expect(canonicalFieldKey('quantityShipped')).toBe('qty')
    expect(canonicalFieldKey('pol')).toBe('polRaw')
    expect(canonicalFieldKey('polId')).toBe('polRaw')
    expect(canonicalFieldKey('forwarder')).toBe('forwarderRaw')
    expect(canonicalFieldKey('voyage_number')).toBe('voyageNo')
    expect(canonicalFieldKey('crd')).toBe('cargoReadyDate')
    expect(canonicalFieldKey('hbl_number')).toBe('hblAwbFcrNo')
  })

  it('passes plain snake_case through to its camel leg column', () => {
    expect(canonicalFieldKey('gross_weight')).toBe('grossWeight')
    expect(canonicalFieldKey('cfs_cutoff')).toBe('cfsCutoff')
    expect(canonicalFieldKey('vessel_name')).toBe('vesselName')
  })

  it('leaves an already-canonical column unchanged and camelises the unknown', () => {
    expect(canonicalFieldKey('qty')).toBe('qty')
    expect(canonicalFieldKey('polRaw')).toBe('polRaw')
    expect(canonicalFieldKey('some_new_key')).toBe('someNewKey')
  })
})

describe('historyCategoryOf — field → one of five categories', () => {
  it('places field edits into their Order Details section', () => {
    expect(historyCategoryOf('bookingNo')).toBe('Order Info')
    expect(historyCategoryOf('qty')).toBe('Cargo & Logistics')
    expect(historyCategoryOf('quantity_shipped')).toBe('Cargo & Logistics')
    expect(historyCategoryOf('pol')).toBe('Shipping')
    expect(historyCategoryOf('route')).toBe('Shipping')
    expect(historyCategoryOf('etd')).toBe('Key Dates')
    expect(historyCategoryOf('crd')).toBe('Key Dates')
  })

  it('routes lifecycle / flag / unknown keys to Status & Lifecycle', () => {
    expect(historyCategoryOf('status')).toBe('Status & Lifecycle')
    expect(historyCategoryOf('reviewStatus')).toBe('Status & Lifecycle')
    expect(historyCategoryOf('risk_level')).toBe('Status & Lifecycle')
    expect(historyCategoryOf('poQtyConflict')).toBe('Status & Lifecycle')
    expect(historyCategoryOf('brand_new_backend_key')).toBe('Status & Lifecycle')
  })
})

describe('groupHistoryByCategory — fixed order, empty omitted', () => {
  it('returns only non-empty categories in HISTORY_CATEGORY_ORDER', () => {
    // grossWeight is not in EDITABLE_FIELDS → Status & Lifecycle catch-all (not Cargo).
    const groups = groupHistoryByCategory([
      entry('status'),
      entry('qty'),
      entry('bookingNo'),
      entry('grossWeight'),
    ])
    expect(groups.map((g) => g.category)).toEqual([
      'Order Info',
      'Cargo & Logistics',
      'Status & Lifecycle',
    ])
    const cargo = groups.find((g) => g.category === 'Cargo & Logistics')!
    expect(cargo.entries.map((e) => e.field)).toEqual(['qty'])
    const status = groups.find((g) => g.category === 'Status & Lifecycle')!
    expect(status.entries.map((e) => e.field).sort()).toEqual(['grossWeight', 'status'].sort())
  })

  it('returns [] for empty history', () => {
    expect(groupHistoryByCategory([])).toEqual([])
  })
})

describe('per-field lookup — a read-view column matches all its history aliases', () => {
  it('finds quantity_shipped entries when addressed by the qty column', () => {
    const index = indexHistoryByField([
      entry('quantity_shipped', { newValue: '300', changedAt: '2026-07-15T00:00:00.000Z' }),
      entry('qty', { newValue: '350', changedAt: '2026-07-18T00:00:00.000Z' }),
      entry('bookingNo'),
    ])
    const qtyHistory = historyForField('qty', index)
    expect(qtyHistory).toHaveLength(2)
    expect(qtyHistory.map((e) => e.newValue)).toEqual(['300', '350'])
  })

  it('matches the polRaw read column to pol email-token entries', () => {
    const index = indexHistoryByField([entry('pol', { newValue: 'CNYTN' })])
    expect(historyForField('polRaw', index)).toHaveLength(1)
    expect(historyForField('mbl', index)).toHaveLength(0)
  })
})
