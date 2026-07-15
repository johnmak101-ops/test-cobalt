import { describe, it, expect } from 'vitest'
import { aggregateRoutingShadow } from './routing-shadow-report'

describe('aggregateRoutingShadow', () => {
  it('counts totals and flip directions', () => {
    const rows = [
      { gateRouting: 'confirmed', bandRouting: 'confirmed', differs: false, shipmentId: 'a', ingestedAt: new Date(), band: 'high' },
      { gateRouting: 'provisional', bandRouting: 'confirmed', differs: true, shipmentId: 'b', ingestedAt: new Date(), band: 'high' },
      { gateRouting: 'confirmed', bandRouting: 'provisional', differs: true, shipmentId: 'c', ingestedAt: new Date(), band: 'low' },
    ]
    const r = aggregateRoutingShadow(rows, 30)
    expect(r.total).toBe(3)
    expect(r.differs).toBe(2)
    expect(r.reviewToAuto).toBe(1)
    expect(r.autoToReview).toBe(1)
  })

  it('samples prefer differs; falls back to recent when none', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z')
    const t1 = new Date('2026-01-02T00:00:00.000Z')
    const same = [
      { gateRouting: 'confirmed', bandRouting: 'confirmed', differs: false, shipmentId: 'a', ingestedAt: t1, band: 'high' },
      { gateRouting: 'provisional', bandRouting: 'provisional', differs: false, shipmentId: 'b', ingestedAt: t0, band: 'low' },
    ]
    const noDiff = aggregateRoutingShadow(same, 7)
    expect(noDiff.samples).toHaveLength(2)
    expect(noDiff.samples[0]?.shipmentId).toBe('a')
    expect(noDiff.samples[0]?.ingestedAt).toBe(t1.toISOString())

    const mixed = [
      { gateRouting: 'confirmed', bandRouting: 'provisional', differs: true, shipmentId: 'd', ingestedAt: t1, band: 'low' },
      { gateRouting: 'confirmed', bandRouting: 'confirmed', differs: false, shipmentId: 'e', ingestedAt: t0, band: 'high' },
    ]
    const withDiff = aggregateRoutingShadow(mixed, 7)
    expect(withDiff.samples).toHaveLength(1)
    expect(withDiff.samples[0]?.shipmentId).toBe('d')
    expect(withDiff.windowDays).toBe(7)
  })
})
