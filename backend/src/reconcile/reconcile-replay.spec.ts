import { describe, it, expect, vi } from 'vitest'
import { ReconcileService } from './reconcile.service'
import type { CommitResult, ReconGroup } from './committer.service'

/**
 * #428 autopsy pins (closes the candrholdings#34 question): rebuild = REPLAY of the decision log
 * through the committer. The two failure modes of the legacy derive path — dropping
 * net_weight/cargo_description/cfs_cutoff (absent from merge.ts FIELD_CLASS) and resurrecting a
 * Customs-masked atd out of raw evidence — are impossible BY CONSTRUCTION in replay mode, because
 * the committer's own column mask carries those fields and raw evidence is never consulted. These
 * specs pin exactly that construction so a future "optimization" cannot quietly reintroduce a
 * second brain.
 */
const commitResult = (i: number): CommitResult => ({ jobNo: `JOB-${i}` }) as unknown as CommitResult

function makeService(loggedPayloads: unknown[]) {
  const applied: ReconGroup[] = []
  const committer = { apply: vi.fn(async (g: ReconGroup) => (applied.push(g), commitResult(applied.length))) }
  const evidence = { allWithMessage: vi.fn(async () => { throw new Error('replay must NEVER read raw evidence') }) }
  const settings = { confidenceThreshold: vi.fn(async () => 60) }
  const decisionLog = { allInOrder: vi.fn(async () => loggedPayloads.map((payload, i) => ({ id: i + 1, payload }))), append: vi.fn() }
  const svc = new ReconcileService(
    evidence as never,
    committer as never,
    settings as never,
    decisionLog as never,
  )
  return { svc, applied, committer, evidence }
}

describe('ReconcileService.run — replay mode (decision log non-empty)', () => {
  const fragileFields = {
    booking_no: 'SZX111',
    net_weight: '1,234.5',
    cargo_description: 'KNITTED GARMENTS',
    cfs_cutoff: '2026-07-10',
  }

  it('replays every logged group through the committer IN ORDER, fields intact — including the three the legacy derive dropped', async () => {
    const g1 = { matchKey: { booking_no: 'SZX111' }, fields: fragileFields, pos: ['28739'] }
    const g2 = { matchKey: { booking_no: 'SZX222' }, fields: { booking_no: 'SZX222' }, pos: [] }
    const { svc, applied } = makeService([JSON.stringify(g1), JSON.stringify(g2)])
    const res = await svc.run()
    expect(res.mode).toBe('replay')
    expect(res.groups).toBe(2)
    expect(applied).toHaveLength(2)
    // arrival order preserved, and the committer receives the EXACT logged fields — net_weight /
    // cargo_description / cfs_cutoff ride through because the committer's own mask (not merge.ts
    // FIELD_CLASS) is the vocabulary on this path.
    expect(applied[0]!.fields).toEqual(fragileFields)
    expect((applied[1]!.matchKey as Record<string, unknown>).booking_no).toBe('SZX222')
  })

  it('accepts payloads the JSON plugin already parsed (object) AND raw strings — both shapes replay identically', async () => {
    const g = { matchKey: {}, fields: fragileFields, pos: [] }
    const { svc: svcObj, applied: appliedObj } = makeService([g])
    const { svc: svcStr, applied: appliedStr } = makeService([JSON.stringify(g)])
    await svcObj.run()
    await svcStr.run()
    expect(appliedObj[0]!.fields).toEqual(appliedStr[0]!.fields)
  })

  it('NEVER consults raw evidence in replay mode — a Customs-masked atd cannot be resurrected from a source that is never read', async () => {
    // The queue masks Customs-doc atd BEFORE the wire, so logged groups carry none. The only way a
    // rebuild could resurrect it is by re-deriving from raw evidence — pinned here as impossible.
    const { svc, applied, evidence } = makeService([
      JSON.stringify({ matchKey: {}, fields: { booking_no: 'SZX111' }, pos: [] }),
    ])
    await svc.run()
    expect(evidence.allWithMessage).not.toHaveBeenCalled()
    expect(applied[0]!.fields).not.toHaveProperty('atd')
  })
})
