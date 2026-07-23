import { describe, it, expect, vi } from 'vitest'
import { StateRefreshService } from './state-refresh.service'

type Leg = Record<string, unknown>

/** Minimal harness: one in-memory leg set + captured writes. */
function harness(legs: Leg[], typesByShipment: Record<string, string[]> = {}) {
  const setState = vi.fn().mockResolvedValue(undefined)
  const write = vi.fn().mockResolvedValue(undefined)
  const shipments = {
    legsForStateRefresh: vi.fn().mockResolvedValue(legs),
    emailTypesForShipments: vi
      .fn()
      .mockResolvedValue(
        new Map(Object.entries(typesByShipment).map(([id, types]) => [id, new Set(types)])),
      ),
    setState,
  }
  const audit = { write }
  const svc = new StateRefreshService(shipments as never, audit as never)
  return { svc, setState, write, shipments }
}

const leg = (over: Leg = {}): Leg => ({
  id: 'leg-1',
  state: 'BOOKED',
  bookingNo: 'BK1',
  soNo: null,
  mbl: null,
  hblAwbFcrNo: null,
  warehouseStartDate: null,
  etd: null,
  atd: null,
  eta: null,
  ata: null,
  inDcDate: null,
  ...over,
})

const NOW = new Date('2026-07-23T00:00:00Z')

describe('StateRefreshService — the calendar, not an email', () => {
  /**
   * The whole point. deriveState's `departed && eta <= today` rule was already true months ago, but
   * nothing re-ran it because no email arrived. GZL26261147 in the live data sat at DEPARTED with an
   * ETA five months past.
   */
  it('promotes a departed leg whose ETA has since passed', async () => {
    const { svc, setState } = harness([
      leg({ state: 'RELEASED', atd: new Date('2026-02-08T00:00:00Z'), eta: new Date('2026-02-11T00:00:00Z') }),
    ])
    const res = await svc.refresh(NOW)
    expect(res.promotions).toHaveLength(1)
    expect(res.promotions[0]).toMatchObject({ from: 'RELEASED', to: 'DELIVERED', reason: 'ETA has passed' })
    expect(setState).toHaveBeenCalledWith('leg-1', 'DELIVERED')
  })

  /**
   * Dates arrive from the driver as JS Date objects, and deriveState's day compare does
   * String(v).slice(0, 10) against /^\d{4}-\d{2}-\d{2}$/. "Wed Jul 23 2026 …" fails that, so every
   * date rule would silently never fire. legFields must hand over ISO strings.
   */
  it('reads Date columns, not just ISO strings (the slice(0,10) trap)', async () => {
    const asDates = harness([
      leg({ state: 'BOOKED', warehouseStartDate: new Date('2026-07-01T00:00:00Z') }),
    ])
    const asStrings = harness([leg({ state: 'BOOKED', warehouseStartDate: '2026-07-01T00:00:00Z' })])
    const a = await asDates.svc.refresh(NOW)
    const b = await asStrings.svc.refresh(NOW)
    expect(a.promotions[0]?.to).toBe('AT_WAREHOUSE')
    expect(b.promotions[0]?.to).toBe('AT_WAREHOUSE')
  })

  it('leaves a future warehouse date alone — a planned open is schedule, not fact', async () => {
    const { svc, setState } = harness([
      leg({ state: 'BOOKED', warehouseStartDate: new Date('2026-09-01T00:00:00Z') }),
    ])
    const res = await svc.refresh(NOW)
    expect(res.promotions).toEqual([])
    expect(setState).not.toHaveBeenCalled()
  })

  /**
   * PROMOTE ONLY. A recompute can come out lower than what is stored — a human clears an ATD, or a
   * leg predates shipment_emails so it has no recorded types at all. Walking a shipment backwards
   * without a human asking would be worse than leaving it stale.
   */
  it('never walks a leg backwards when the recompute comes out lower', async () => {
    // Stored RELEASED, but nothing on the leg proves it any more: no atd, no email types.
    const { svc, setState, write } = harness([leg({ state: 'RELEASED' })])
    const res = await svc.refresh(NOW)
    expect(res.promotions).toEqual([])
    expect(setState).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  /**
   * A skip is a signal, not a shrug: a leg storing a state its own evidence cannot reproduce gets
   * reported, never quietly passed over and never "corrected" downward.
   *
   * This used to be driven by GZL26261147's shape (RELEASED, no atd, ETA long past). Since the
   * passed-ETA rule dropped its departure gate that leg now PROMOTES to DELIVERED — the point of
   * the change — so the case needs a leg with no arrival-side evidence at all: stored RELEASED,
   * only a Final B/L on file, which derives no higher than SAILED.
   */
  it('reports a leg whose stored state its evidence no longer proves', async () => {
    const { svc, setState } = harness([leg({ state: 'RELEASED' })], { 'leg-1': ['Final B/L'] })
    const res = await svc.refresh(NOW)
    expect(res.promotions).toEqual([])
    expect(res.regressions).toHaveLength(1)
    expect(res.regressions[0]).toMatchObject({ from: 'RELEASED', to: 'SAILED' })
    expect(setState).not.toHaveBeenCalled()
  })

  // The leg that prompted the rule change: Departure with no ATD and an ETA months past. It must
  // now climb rather than sit in the regressions list.
  it('promotes the GZL26261147 shape — Departure, no ATD, ETA long past', async () => {
    const { svc, setState } = harness(
      [leg({ state: 'RELEASED', atd: null, etd: new Date('2026-02-08T00:00:00Z'), eta: new Date('2026-02-11T00:00:00Z') })],
      { 'leg-1': ['Final B/L'] },
    )
    const res = await svc.refresh(NOW)
    expect(res.regressions).toEqual([])
    expect(res.promotions[0]).toMatchObject({ from: 'RELEASED', to: 'DELIVERED', reason: 'ETA has passed' })
    expect(setState).toHaveBeenCalledWith('leg-1', 'DELIVERED')
  })

  it('does not rewrite a leg that is already at the right state', async () => {
    const { svc, setState } = harness([
      leg({ state: 'DELIVERED', atd: new Date('2026-01-01T00:00:00Z'), ata: new Date('2026-02-01T00:00:00Z') }),
    ])
    const res = await svc.refresh(NOW)
    expect(res.promotions).toEqual([])
    expect(setState).not.toHaveBeenCalled()
  })

  it('dryRun reports the promotions and writes nothing', async () => {
    const { svc, setState, write } = harness([
      leg({ state: 'RELEASED', atd: new Date('2026-02-08T00:00:00Z'), eta: new Date('2026-02-11T00:00:00Z') }),
    ])
    const res = await svc.refresh(NOW, { dryRun: true })
    expect(res.dryRun).toBe(true)
    expect(res.applied).toBe(0)
    expect(res.promotions).toHaveLength(1)
    expect(setState).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('records the promotion in Change History as a system change, with no actor', async () => {
    const { svc, write } = harness([
      leg({ state: 'RELEASED', atd: new Date('2026-02-08T00:00:00Z'), eta: new Date('2026-02-11T00:00:00Z') }),
    ])
    await svc.refresh(NOW)
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'shipment',
        entityId: 'leg-1',
        field: 'state',
        oldValue: 'RELEASED',
        newValue: 'DELIVERED',
        sourceType: 'system',
      }),
    )
    expect(write.mock.calls[0][0]).not.toHaveProperty('actorUserId')
  })

  // The email half still counts: types recorded on the leg feed deriveState exactly as at commit.
  it('uses the email types recorded on the leg', async () => {
    const { svc } = harness([leg({ state: 'BOOKED' })], { 'leg-1': ['Final B/L'] })
    const res = await svc.refresh(NOW)
    expect(res.promotions[0]).toMatchObject({ to: 'SAILED', reason: expect.any(String) })
  })

  it('counts every scanned leg, not just the promoted ones', async () => {
    const { svc } = harness([
      leg({ id: 'a', state: 'BOOKED' }),
      leg({ id: 'b', state: 'RELEASED', atd: new Date('2026-01-01T00:00:00Z'), eta: new Date('2026-01-05T00:00:00Z') }),
    ])
    const res = await svc.refresh(NOW)
    expect(res.scanned).toBe(2)
    expect(res.applied).toBe(1)
  })
})
