import { describe, it, expect } from 'vitest'
import { fieldLabel } from './field-labels'

describe('fieldLabel — Change History field keys → human labels', () => {
  it('maps editable leg columns to the Review page labels', () => {
    expect(fieldLabel('bookingNo')).toBe('Booking No.')
    expect(fieldLabel('soNo')).toBe('SO#')
    expect(fieldLabel('hblAwbFcrNo')).toBe('HBL / HAWB / FCR No.')
    expect(fieldLabel('scacCode')).toBe('SCAC Code')
    expect(fieldLabel('cargoReadyDate')).toBe('Cargo Ready Date')
    expect(fieldLabel('inDcDate')).toBe('In DC Date')
  })

  it('maps bag Item / Style No. (hidden from Order Details form; history still labels it)', () => {
    expect(fieldLabel('itemStyleNo')).toBe('Item / Style No.')
    expect(fieldLabel('item_style_no')).toBe('Item / Style No.')
  })

  it('maps warehouseSo (入仓/订仓) to Warehouse SO', () => {
    expect(fieldLabel('warehouseSo')).toBe('Warehouse SO')
    expect(fieldLabel('warehouse_so')).toBe('Warehouse SO')
  })

  it('drops the unit suffix for weight/measure (the value carries the unit)', () => {
    expect(fieldLabel('grossWeight')).toBe('Gross Weight')
    expect(fieldLabel('measurement')).toBe('Measurement')
  })

  it('maps email-replay + committer-only keys not on the Review page', () => {
    expect(fieldLabel('pol')).toBe('POL')
    expect(fieldLabel('pod')).toBe('POD')
    expect(fieldLabel('polId')).toBe('POL')
    expect(fieldLabel('forwarder')).toBe('Forwarder')
    expect(fieldLabel('forwarderRaw')).toBe('Forwarder')
    expect(fieldLabel('originCountry')).toBe('Origin Country')
    expect(fieldLabel('mode')).toBe('Mode')
    expect(fieldLabel('flightNo')).toBe('Flight No.')
    expect(fieldLabel('mawb')).toBe('MAWB')
  })

  it('maps lifecycle/audit keys', () => {
    expect(fieldLabel('state')).toBe('Status')
    expect(fieldLabel('status')).toBe('Status')
    expect(fieldLabel('reviewStatus')).toBe('Review Status')
    expect(fieldLabel('kind')).toBe('Record Type')
    expect(fieldLabel('po_qty_conflict')).toBe('PO Qty Conflict')
  })

  it('humanizes an unknown camelCase key (no code casing leaks through)', () => {
    expect(fieldLabel('someNewField')).toBe('Some New Field')
    expect(fieldLabel('cbmTotal')).toBe('CBM Total')
    expect(fieldLabel('warehouse_end_date')).toBe('Warehouse End Date')
  })

  it('never returns a raw code-cased token for a known key', () => {
    for (const k of ['bookingNo', 'pol', 'pod', 'cargoReadyDate', 'grossWeight', 'consigneeName', 'forwarder', 'state']) {
      expect(fieldLabel(k)).not.toBe(k)
    }
  })

  it('handles empty/nullish gracefully', () => {
    expect(fieldLabel('')).toBe('')
    expect(fieldLabel(null)).toBe('')
    expect(fieldLabel(undefined)).toBe('')
  })
})
