import { describe, it, expect } from 'vitest'
import { toUiHistoryEntry, type ChangeLogRow } from './history.mapper'

const row = (over: Partial<ChangeLogRow> = {}): ChangeLogRow => ({
  id: 'chg-1',
  entityType: 'shipment',
  entityId: 'leg-1',
  field: 'etd',
  oldValue: '2026-02-05',
  newValue: '2026-02-07',
  sourceType: 'email',
  sourceId: 'evrec-9',
  actorUserId: null,
  isDelay: true,
  note: 'ETD pushed by 2 days',
  createdAt: new Date('2026-02-04T00:00:00.000Z'),
  ...over,
})

describe('toUiHistoryEntry — audit.change_log row -> UI HistoryEntry', () => {
  it('renames entityId/actorUserId/note/createdAt and passes the rest', () => {
    const h = toUiHistoryEntry(row())
    expect(h.id).toBe('chg-1')
    expect(h.shipmentId).toBe('leg-1')
    expect(h.field).toBe('etd')
    expect(h.oldValue).toBe('2026-02-05')
    expect(h.newValue).toBe('2026-02-07')
    expect(h.sourceType).toBe('email')
    expect(h.sourceId).toBe('evrec-9')
    expect(h.changedBy).toBeNull()
    expect(h.changedAt).toBe('2026-02-04T00:00:00.000Z')
    expect(h.isDelay).toBe(true)
    expect(h.notes).toBe('ETD pushed by 2 days')
  })

  it('maps the agent source type onto the UI-visible "system"', () => {
    expect(toUiHistoryEntry(row({ sourceType: 'agent' })).sourceType).toBe('system')
    expect(toUiHistoryEntry(row({ sourceType: 'manual', actorUserId: 'user-7' })).changedBy).toBe('user-7')
  })
})
