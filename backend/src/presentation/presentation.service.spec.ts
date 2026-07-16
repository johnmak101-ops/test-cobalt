import { describe, it, expect } from 'vitest'
import { PresentationService } from './presentation.service'

const D = (s: string) => new Date(s)

const ports = [
  { id: 'p1', unlocode: 'CNYTN', country: 'CN' },
  { id: 'p2', unlocode: 'GBFXT', country: 'GB' },
]
const customers = [{ id: 'c1', code: 'COLE', name: 'Cole Haan' }]
const vendors = [{ id: 'v1', code: 'ROKNFT', name: 'Rose Knit' }]
const forwarders = [{ id: 'f1', code: 'FAIR', name: 'Fairate' }]
const bookings = [{ id: 'b1', customerId: 'c1', vendorId: 'v1' }]
const legs = [
  {
    id: 'leg1', bookingId: 'b1', legStatus: 'ACTIVE', state: 'SAILED', forwarderId: 'f1',
    polId: 'p1', podId: 'p2', riskLevel: 'AT_RISK', soNo: 'SO1', qty: 100, qtyUnit: 'cartons',
    consigneeName: 'Acme Consignee',
    updatedAt: D('2026-02-10T00:00:00.000Z'),
  },
  {
    id: 'leg2', bookingId: 'b1', legStatus: 'ACTIVE', state: 'DELIVERED', forwarderId: 'f1',
    polId: 'p1', podId: 'p2', riskLevel: 'ON_TRACK', updatedAt: D('2026-02-09T00:00:00.000Z'),
  },
]
const alerts = [
  {
    id: 'al1', ruleId: 'A1', shipmentId: 'leg1', severity: 'CRITICAL', status: 'ACTIVE',
    message: 'No Draft B/L', firedAt: D('2026-02-10T00:00:00.000Z'),
    readAt: null, dismissedAt: null, snoozedUntil: null,
  },
]
const rules = [{
  id: 'A1', name: 'No Draft BOL', description: 'd', state: 'CONFIRMED', triggerType: 'days_after',
  triggerReference: 'booking_request', watchFor: 'so', thresholdHours: 48, severity: 'WARNING',
  enabled: true, locked: false,
}]
const auditRows = [{
  id: 'chg1', entityType: 'shipment', entityId: 'leg1', field: 'etd', oldValue: '2026-02-05',
  newValue: '2026-02-07', sourceType: 'email', sourceId: 'ev1', actorUserId: null, isDelay: true,
  note: 'pushed', createdAt: D('2026-02-04T00:00:00.000Z'),
}]

const build = () => {
  const shipmentRepo = {
    activeLegs: async () => legs,
    findById: async (id: string) => legs.find((l) => l.id === id) ?? null,
    findByIds: async (ids: string[]) => new Map(legs.filter((l) => ids.includes(l.id)).map((l) => [l.id, l])),
    milestonesFor: async () => [],
    posFor: async () => [],
    poNumbersByShipment: async () => new Map<string, string[]>(),
    linkedPosForBooking: async (id: string) =>
      id === 'b1'
        ? [{ id: 'po1', poNumber: 'PO-1', totalQuantity: 5000, quantityUnit: 'pieces', vendorName: 'Rose Knit' }]
        : [],
    // #151: per-leg empty → falls back to booking union
    linkedPosForShipment: async () => [],
    legsForBooking: async (id: string) => legs.filter((l) => l.bookingId === id),
    identifiersFor: async () => [],
  }
  const bookingRepo = {
    listOrdered: async () => bookings,
    findById: async (id: string) => bookings.find((b) => b.id === id) ?? null,
    findByIds: async (ids: string[]) => new Map(bookings.filter((b) => ids.includes(b.id)).map((b) => [b.id, b])),
    poNumbersFor: async (id: string) => (id === 'b1' ? ['PO-1'] : []),
    poNumbersByBooking: async (ids: string[]) => new Map(ids.filter((id) => id === 'b1').map((id) => [id, ['PO-1']])),
  }
  const mastersRepo = {
    listCustomers: async () => customers,
    listVendors: async () => vendors,
    listForwarders: async () => forwarders,
    listPorts: async () => ports,
    listConsignees: async () => [],
  }
  const alertRepo = {
    list: async (status?: string) => (status ? alerts.filter((a) => a.status === status) : alerts),
    allRules: async () => rules,
  }
  const auditRepo = { listForEntity: async (_t: string, id: string) => (id === 'leg1' ? auditRows : []) }
  const emailRepo = {
    unreadCount: async () => 3,
    ingestionStatus: async () => ({ count: 0, lastAt: null }),
    ingestState: async () => null,
    emailsForShipment: async () => [],
  }
  const evidenceRepo = { forMessages: async () => [], allWithMessage: async () => [] }
  const shipmentsLookup = { lookupByMatchKey: async () => ({ query: {}, candidates: [] }) }
  return new PresentationService(
    shipmentRepo as any, bookingRepo as any, mastersRepo as any, alertRepo as any, auditRepo as any, emailRepo as any,
    evidenceRepo as any,
    shipmentsLookup as any,
  )
}

describe('PresentationService.shipments — list', () => {
  it('assembles flat shipments from active legs + booking + masters + ports + poNumbers', async () => {
    const { shipments } = await build().shipments()
    expect(shipments).toHaveLength(2)
    const s = shipments.find((x) => x.id === 'leg1')!
    expect(s.status).toBe('SAILED')
    expect(s.poNumbers).toBe('["PO-1"]')
    expect(s.route).toBe('CNYTN→GBFXT')
    expect(s.originCountry).toBe('CN')
    expect(s.customer).toEqual({ id: 'c1', name: 'Cole Haan', code: 'COLE' })
    expect(s.vendor).toEqual({ id: 'v1', name: 'Rose Knit', code: 'ROKNFT' })
    expect(s.forwarder).toEqual({ id: 'f1', name: 'Fairate', code: 'FAIR' })
    // linkedPOs carry the real PO id (drill-down), vendor, and qty/unit — not the old {poNumber} stub
    expect(s.linkedPOs).toEqual([
      { id: 'po1', poNumber: 'PO-1', totalQuantity: 5000, quantityUnit: 'pieces', quantity: null, itemStyleNo: null, brand: null, qtyIssue: null, qtyIssueDetail: null, vendor: { name: 'Rose Knit' }, sharedBroadcastTotal: null, sharedBroadcastUnit: null },
    ])
  })

  it('filters by UI status', async () => {
    const { shipments } = await build().shipments({ status: 'SAILED' })
    expect(shipments.map((s) => s.id)).toEqual(['leg1'])
  })

  it('filters by customerId and forwarderId', async () => {
    expect((await build().shipments({ customerId: 'c1' })).shipments).toHaveLength(2)
    expect((await build().shipments({ customerId: 'cX' })).shipments).toHaveLength(0)
    expect((await build().shipments({ forwarderId: 'f1' })).shipments).toHaveLength(2)
  })
})

describe('PresentationService.shipment — detail', () => {
  it('returns the flat detail with milestones/alerts/linkedPOs attached', async () => {
    const d = await build().shipment('leg1')
    expect(d.id).toBe('leg1')
    expect(d.status).toBe('SAILED')
    expect(Array.isArray(d.milestones)).toBe(true)
    expect(d.alerts).toHaveLength(1)
    expect(d.alerts[0].id).toBe('al1')
    expect(Array.isArray(d.emails)).toBe(true)
  })

  it('throws when the leg does not exist', async () => {
    await expect(build().shipment('nope')).rejects.toThrow()
  })
})

describe('PresentationService.shipmentHistory', () => {
  it('maps audit rows to history entries', async () => {
    const { history } = await build().shipmentHistory('leg1')
    expect(history).toHaveLength(1)
    expect(history[0].shipmentId).toBe('leg1')
    expect(history[0].changedAt).toBe('2026-02-04T00:00:00.000Z')
    expect(history[0].notes).toBe('pushed')
  })
})

describe('PresentationService.alerts + alertRules', () => {
  it('maps alerts and nests the shipment summary', async () => {
    const { alerts: out } = await build().alerts()
    expect(out).toHaveLength(1)
    expect(out[0].triggeredAt).toBe('2026-02-10T00:00:00.000Z')
    expect(out[0].shipment).toEqual({
      id: 'leg1',
      poNumbers: '["PO-1"]',
      route: 'CNYTN→GBFXT',
      customer: { name: 'Cole Haan' },
      consigneeName: 'Acme Consignee',
    })
  })

  it('maps alert rules with hours->days', async () => {
    const { rules: out } = await build().alertRules()
    expect(out[0].thresholdDays).toBe(2)
    expect(out[0].countryThresholds).toBeNull()
  })
})

describe('PresentationService.dashboard', () => {
  it('computes the KPI stats from legs + alerts', async () => {
    const d = await build().dashboard()
    expect(d.stats.activeShipments).toBe(1) // non-DELIVERED active legs
    expect(d.stats.warningAlerts).toBe(0)
    expect(d.stats.criticalAlerts).toBe(1)
    expect(d.stats).not.toHaveProperty('atRiskShipments')
    expect(d.stats.newEmails).toBe(3) // inbox unread count (same as /emails/unread-count)
    expect(Array.isArray(d.recentAlerts)).toBe(true)
    expect(Array.isArray(d.recentActivity)).toBe(true)
  })

  it('counts ACTIVE warning/critical alerts by severity (excludes RESOLVED)', async () => {
    const mixed = [
      { id: 'w1', ruleId: 'A1', shipmentId: 'leg1', severity: 'WARNING', status: 'ACTIVE', message: 'w1', firedAt: D('2026-02-10T00:00:00.000Z'), readAt: null, dismissedAt: null, snoozedUntil: null },
      { id: 'w2', ruleId: 'A1', shipmentId: 'leg1', severity: 'WARNING', status: 'ACTIVE', message: 'w2', firedAt: D('2026-02-10T01:00:00.000Z'), readAt: null, dismissedAt: null, snoozedUntil: null },
      { id: 'c1', ruleId: 'A1', shipmentId: 'leg1', severity: 'CRITICAL', status: 'ACTIVE', message: 'c1', firedAt: D('2026-02-10T02:00:00.000Z'), readAt: null, dismissedAt: null, snoozedUntil: null },
      { id: 'w3', ruleId: 'A1', shipmentId: 'leg1', severity: 'WARNING', status: 'RESOLVED', message: 'w3', firedAt: D('2026-02-09T00:00:00.000Z'), readAt: null, dismissedAt: null, snoozedUntil: null },
    ]
    const shipmentRepo = {
      activeLegs: async () => legs,
      findByIds: async (ids: string[]) => new Map(legs.filter((l) => ids.includes(l.id)).map((l) => [l.id, l])),
      poNumbersByShipment: async () => new Map<string, string[]>(),
      linkedPosForBooking: async () => [],
    }
    const bookingRepo = {
      listOrdered: async () => bookings,
      findByIds: async (ids: string[]) => new Map(bookings.filter((b) => ids.includes(b.id)).map((b) => [b.id, b])),
      poNumbersByBooking: async () => new Map<string, string[]>(),
      poNumbersFor: async () => [],
    }
    const mastersRepo = {
      listCustomers: async () => customers,
      listVendors: async () => vendors,
      listForwarders: async () => forwarders,
      listPorts: async () => ports,
      listConsignees: async () => [],
    }
    const alertRepo = {
      list: async (status?: string) => (status ? mixed.filter((a) => a.status === status) : mixed),
      allRules: async () => rules,
    }
    const svc = new PresentationService(
      shipmentRepo as any, bookingRepo as any, mastersRepo as any, alertRepo as any,
      { listForEntity: async () => [] } as any,
      { unreadCount: async () => 0, ingestionStatus: async () => ({ count: 0, lastAt: null }), ingestState: async () => null, emailsForShipment: async () => [] } as any,
      { forMessages: async () => [], allWithMessage: async () => [] } as any,
      { lookupByMatchKey: async () => ({ query: {}, candidates: [] }) } as any,
    )
    const d = await svc.dashboard()
    expect(d.stats.warningAlerts).toBe(2)
    expect(d.stats.criticalAlerts).toBe(1)
    expect(d.stats).not.toHaveProperty('atRiskShipments')
  })
})
