import { describe, it, expect } from 'vitest'
import { CandidatesService } from './candidates.service'
import type { MastersRepository } from '../db/repositories/masters.repository'

type Fact = { kind: string; lhs: string; rhs: string | null }

/** Hand-rolled MastersRepository stub — exposes only the methods CandidatesService actually calls for
 *  the kind under test (`listResolution` is always called, unconditionally, by priorCorrections). */
function portRepo(opts: {
  ports?: { unlocode: string; name: string; country: string | null; mode: string; iata: string | null }[]
  facts?: Fact[]
}) {
  const repo = {
    listPorts: async () => opts.ports ?? [],
    listResolution: async (_status: string) => opts.facts ?? [],
  }
  return { svc: new CandidatesService(repo as unknown as MastersRepository) }
}

function forwarderRepo(opts: {
  forwarders?: { id: string; code: string | null; name: string }[]
  forwarderAliases?: { forwarderId: string; aliasType: string; value: string }[]
  facts?: Fact[]
}) {
  const repo = {
    listForwarders: async () => opts.forwarders ?? [],
    listForwarderAliases: async () => opts.forwarderAliases ?? [],
    listResolution: async (_status: string) => opts.facts ?? [],
  }
  return { svc: new CandidatesService(repo as unknown as MastersRepository) }
}

describe('CandidatesService — port kind', () => {
  it("kind='port' surfaces ports with fact-lhs aliases + iata, and mode rides the candidate", async () => {
    const { svc } = portRepo({
      ports: [{ unlocode: 'VNSGN', name: 'Ho Chi Minh City', country: 'Vietnam', mode: 'sea', iata: 'SGN' }],
      facts: [{ kind: 'port_abbreviation', lhs: 'HCM', rhs: 'VNSGN' }],
    })
    const { candidates } = await svc.candidates({ type: 'port', name: 'HO CHI MINH' })
    const sgn = candidates.find((c) => c.code === 'VNSGN')
    expect(sgn).toBeTruthy()
    expect(sgn!.mode).toBe('sea')
    expect(sgn!.aliases).toContain('HCM')
    expect(sgn!.aliases).toContain('SGN')
  })
})

describe('CandidatesService — name:tokens recall signal', () => {
  it('name:tokens rescues a short master name (DSV)', async () => {
    const { svc } = forwarderRepo({
      forwarders: [{ id: 'f1', code: 'DSV001', name: 'DSV' }],
      forwarderAliases: [],
    })
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'DSV AIR AND SEA CO LTD' })
    expect(candidates.some((c) => c.code === 'DSV001' && c.signals.includes('name:tokens'))).toBe(true)
  })
})
