import { describe, it, expect } from 'vitest'
import { toUiAlert, type AlertRow } from './alert.mapper'

const alert = (over: Partial<AlertRow> = {}): AlertRow => ({
  id: 'al-1',
  ruleId: 'A1',
  shipmentId: 'leg-1',
  severity: 'CRITICAL',
  message: 'No Draft B/L within window',
  status: 'ACTIVE',
  firedAt: new Date('2026-02-10T00:00:00.000Z'),
  readAt: null,
  dismissedAt: null,
  snoozedUntil: null,
  ...over,
})

describe('toUiAlert — alert row -> UI alert', () => {
  it('renames firedAt -> triggeredAt and nests the shipment summary', () => {
    const a = toUiAlert({
      alert: alert(),
      shipment: { id: 'leg-1', poNumbers: '["PO-1"]', route: 'CNYTN→GBFXT', customer: { name: 'Cole Haan' } },
    })
    expect(a.id).toBe('al-1')
    expect(a.ruleId).toBe('A1')
    expect(a.shipmentId).toBe('leg-1')
    expect(a.severity).toBe('CRITICAL')
    expect(a.status).toBe('ACTIVE')
    expect(a.triggeredAt).toBe('2026-02-10T00:00:00.000Z')
    expect(a.readAt).toBeNull()
    expect(a.shipment).toEqual({ id: 'leg-1', poNumbers: '["PO-1"]', route: 'CNYTN→GBFXT', customer: { name: 'Cole Haan' } })
  })

  it('serializes the action timestamps and tolerates a missing shipment', () => {
    const a = toUiAlert({
      alert: alert({ readAt: new Date('2026-02-11T00:00:00.000Z'), snoozedUntil: new Date('2026-02-12T00:00:00.000Z') }),
    })
    expect(a.readAt).toBe('2026-02-11T00:00:00.000Z')
    expect(a.snoozedUntil).toBe('2026-02-12T00:00:00.000Z')
    expect(a.dismissedAt).toBeNull()
    expect(a.shipment).toBeNull()
  })
})
