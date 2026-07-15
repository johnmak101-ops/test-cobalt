import { describe, it, expect } from 'vitest'
import { aggregateCriticCalibration } from './critic-calibration-report'

const row = (over: Partial<{ band: string | null; outcome: string; correctedFieldCount: number }>) => ({
  shipmentId: 's1',
  decidedAt: new Date('2026-07-01T00:00:00Z'),
  band: over.band ?? null,
  outcome: over.outcome ?? 'approved',
  correctedFieldCount: over.correctedFieldCount ?? 0,
  actorId: 'u1',
})

describe('aggregateCriticCalibration', () => {
  it('empty window → zeros not NaN', () => {
    const r = aggregateCriticCalibration([], 90)
    expect(r.total).toBe(0)
    expect(r.highBandCorrectionRate).toBe(0)
    expect(r.lowMediumApprovedRate).toBe(0)
    expect(r.byBand.high.correctionRate).toBe(0)
  })

  it('computes highBandCorrectionRate and lowMediumApprovedRate', () => {
    const rows = [
      row({ band: 'high', outcome: 'approved' }),
      row({ band: 'high', outcome: 'corrected', correctedFieldCount: 1 }),
      row({ band: 'high', outcome: 'dismissed' }),
      row({ band: 'low', outcome: 'approved' }),
      row({ band: 'medium', outcome: 'approved' }),
      row({ band: 'low', outcome: 'corrected', correctedFieldCount: 2 }),
      row({ band: null, outcome: 'approved' }),
    ]
    const r = aggregateCriticCalibration(rows, 90)
    expect(r.total).toBe(7)
    expect(r.byBand.high).toMatchObject({ total: 3, approved: 1, corrected: 1, dismissed: 1 })
    expect(r.highBandCorrectionRate).toBeCloseTo(1 / 3)
    // low+medium: 3 rows, 2 approved
    expect(r.lowMediumApprovedRate).toBeCloseTo(2 / 3)
    expect(r.byBand.unknown.total).toBe(1)
  })

  it('samples prefer high-band corrected misses, then recent', () => {
    const rows = [
      {
        ...row({ band: 'high', outcome: 'corrected', correctedFieldCount: 1 }),
        shipmentId: 'miss',
        decidedAt: new Date('2026-07-10'),
      },
      {
        ...row({ band: 'low', outcome: 'approved' }),
        shipmentId: 'a',
        decidedAt: new Date('2026-07-09'),
      },
    ]
    const r = aggregateCriticCalibration(rows, 90)
    expect(r.samples[0].shipmentId).toBe('miss')
    expect(r.samples[0].outcome).toBe('corrected')
  })

  it('not truncated when the window count matches the rows analysed', () => {
    const rows = [row({ band: 'high', outcome: 'approved' })]
    const r = aggregateCriticCalibration(rows, 90, 1)
    expect(r.total).toBe(1)
    expect(r.windowTotal).toBe(1)
    expect(r.truncated).toBe(false)
  })

  it('flags truncation when the window holds more rows than were analysed', () => {
    // The caller capped the read: 2 rows analysed out of 5000 in the window. Rates stay over the
    // analysed slice, but the reader must see that `total` is not the window's real volume —
    // otherwise the 2b gate gets decided on a silently truncated denominator.
    const rows = [
      row({ band: 'high', outcome: 'approved' }),
      row({ band: 'high', outcome: 'corrected', correctedFieldCount: 1 }),
    ]
    const r = aggregateCriticCalibration(rows, 90, 5000)
    expect(r.total).toBe(2) // analysed
    expect(r.windowTotal).toBe(5000) // real
    expect(r.truncated).toBe(true)
    expect(r.highBandCorrectionRate).toBeCloseTo(1 / 2) // still computed over the analysed slice
  })

  it('windowTotal defaults to rows analysed when the caller omits it', () => {
    const r = aggregateCriticCalibration([row({ band: 'low' })], 90)
    expect(r.windowTotal).toBe(1)
    expect(r.truncated).toBe(false)
  })
})
