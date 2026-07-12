import { describe, it, expect } from 'vitest'
import { staleEtdReasons, STALE_ETD_MIN_DAYS } from './committer-date-plausibility'

// The WHIS MACFUN case: a "24-Jan-2026" subject date reused across a booking whose emails are all
// from late June 2026. The ETD had "already departed" 156 days before the first email — a reused
// subject / wrong-month date, not a real shipment. Surfacing only: value kept, reviewer verifies.
const event = (receivedAt: string) => ({ receivedAt })

describe('staleEtdReasons — flag an ETD stated implausibly far before the source email', () => {
  it('flags the reused "24-Jan-2026" subject date against a 29-Jun-2026 email', () => {
    const reasons = staleEtdReasons({ etd: '2026-01-24' }, [event('2026-06-29T02:30:11.000Z')])
    // string shape is the contract the frontend humanizer parses: "sender: ETD <date> is <n> days before this email"
    expect(reasons).toEqual(['sender: ETD 2026-01-24 is 156 days before this email'])
  })

  it('does NOT flag an ETD after the email (a normal future departure)', () => {
    expect(staleEtdReasons({ etd: '2026-07-10' }, [event('2026-06-29T02:30:11.000Z')])).toEqual([])
  })

  it('does NOT flag a small gap within tolerance (post-departure reply is common — booking-ingestion gap)', () => {
    const justInside = `2026-06-01` // 28 days before the email, under the 60-day threshold
    expect(staleEtdReasons({ etd: justInside }, [event('2026-06-29T00:00:00.000Z')])).toEqual([])
    expect(STALE_ETD_MIN_DAYS).toBeGreaterThanOrEqual(30) // conservative: don't flag near-departure timing
  })

  it('uses the EARLIEST email (smallest gap) when a thread has several', () => {
    // etd 2026-04-01; earliest email 2026-06-01 (61 days) → flags; a later 2026-06-29 reply must not shrink the gap away
    const reasons = staleEtdReasons({ etd: '2026-04-01' }, [
      event('2026-06-29T00:00:00.000Z'),
      event('2026-06-01T00:00:00.000Z'),
    ])
    expect(reasons).toEqual(['sender: ETD 2026-04-01 is 61 days before this email'])
  })

  it('returns [] when there is no ETD', () => {
    expect(staleEtdReasons({ etd: null }, [event('2026-06-29T00:00:00.000Z')])).toEqual([])
    expect(staleEtdReasons({}, [event('2026-06-29T00:00:00.000Z')])).toEqual([])
  })

  it('returns [] when there is no usable email date', () => {
    expect(staleEtdReasons({ etd: '2026-01-24' }, [])).toEqual([])
    expect(staleEtdReasons({ etd: '2026-01-24' }, [event('not-a-date')])).toEqual([])
  })
})
