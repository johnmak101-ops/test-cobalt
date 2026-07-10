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

  it("port kind ALSO fires the REVERSE subset — a bare city name surfaces that city's airport (the live-probe gap)", async () => {
    const { svc } = portRepo({
      ports: [
        { unlocode: 'CNSHA', name: 'Shanghai', country: 'China', mode: 'sea', iata: null },
        { unlocode: 'CNPVG', name: 'Shanghai Pudong International Airport', country: 'China', mode: 'air', iata: 'PVG' },
      ],
    })
    const { candidates } = await svc.candidates({ type: 'port', name: 'SHANGHAI' })
    const codes = candidates.map((c) => c.code)
    expect(codes).toContain('CNSHA') // trigram/exact path, as before
    const pvg = candidates.find((c) => c.code === 'CNPVG')
    expect(pvg).toBeTruthy() // input⊆master reverse subset — was 0-candidates in the live probe
    expect(pvg!.signals).toContain('name:tokens')
    expect(pvg!.mode).toBe('air') // the LLM picks by mode — both candidates must be on the table
  })

  it('the reverse subset is PORT-ONLY — a bare city name must not flood forwarder candidates', async () => {
    // master long enough that trigram stays under 0.3 (a shorter name like 'Shanghai Global Logistics
    // Ltd' legitimately clears the trigram threshold on its own); tokenSubset WOULD fire here if the
    // reverse direction were open for parties — asserting 0 candidates proves the port-only gate.
    const { svc } = forwarderRepo({
      forwarders: [{ id: 'f1', code: 'SIF001', name: 'Shanghai International Freight Forwarding Company Limited' }],
      forwarderAliases: [],
    })
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'SHANGHAI' })
    expect(candidates).toHaveLength(0)
  })
})
