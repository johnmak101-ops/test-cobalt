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

function vendorRepo(opts: {
  vendors?: { code: string; name: string; type: string; location: string | null; contactEmail: string | null; nameCh: string | null }[]
  facts?: Fact[]
}) {
  const repo = {
    listVendors: async () => opts.vendors ?? [],
    listResolution: async (_status: string) => opts.facts ?? [],
  }
  return { svc: new CandidatesService(repo as unknown as MastersRepository) }
}

describe('CandidatesService — Chinese-name retrieval (name_ch alias + 简↔繁 fold, 0022)', () => {
  it('a simplified-Chinese document name surfaces a master stored with a traditional name_ch (DGJAFA)', async () => {
    const { svc } = vendorRepo({
      vendors: [
        { code: 'DGJAFA', name: 'DONGGUAN CITY JIAFA FASHION CO., LTD.', type: 'factory', location: 'China', contactEmail: null, nameCh: '東莞市嘉發服飾有限公司' },
        { code: 'ROKNFT', name: 'ROSE KNITTING FACTORY LIMITED', type: 'factory', location: 'Hong Kong, SAR China', contactEmail: null, nameCh: '玫瑰針織廠有限公司' },
      ],
    })
    const { candidates } = await svc.candidates({ type: 'vendor', name: '东莞市嘉发服饰有限公司' })
    const hit = candidates.find((c) => c.code === 'DGJAFA')
    expect(hit).toBeTruthy() // was 0-candidates: name_ch dropped at sync + no 简↔繁 fold
    expect(hit!.signals.some((s) => s.startsWith('name:'))).toBe(true)
    expect(hit!.aliases).toContain('東莞市嘉發服飾有限公司') // the LLM sees both scripts
    expect(candidates.some((c) => c.code === 'ROKNFT')).toBe(false) // unrelated Chinese name stays out
  })

  it('a vendor without name_ch serves no alias (no empty-string noise)', async () => {
    const { svc } = vendorRepo({
      vendors: [{ code: 'DSV001', name: 'DSV AIR AND SEA', type: 'agent', location: null, contactEmail: null, nameCh: null }],
    })
    const { candidates } = await svc.candidates({ type: 'vendor', name: 'DSV AIR AND SEA' })
    expect(candidates[0]!.aliases).toEqual([])
  })
})

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

  it('city-length reverse subset still blocked for parties — SHANGHAI must not flood forwarders', async () => {
    // SHANGHAI is 8 chars → not isShortBrandInput; reverse stays port-only for long tokens.
    const { svc } = forwarderRepo({
      forwarders: [{ id: 'f1', code: 'SIF001', name: 'Shanghai International Freight Forwarding Company Limited' }],
      forwarderAliases: [],
    })
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'SHANGHAI' })
    expect(candidates).toHaveLength(0)
  })

  it('short brand reverse: extracted "DSV" surfaces long master name "DSV AIR AND SEA…"', async () => {
    const { svc } = forwarderRepo({
      forwarders: [{ id: 'f1', code: 'DSV001', name: 'DSV AIR AND SEA CO LTD' }],
      forwarderAliases: [],
    })
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'DSV' })
    const hit = candidates.find((c) => c.code === 'DSV001')
    expect(hit).toBeTruthy()
    expect(hit!.signals).toEqual(expect.arrayContaining(['name:tokens', 'name:code']))
  })

  it('short brand code-only: "DSV" matches code DSV001 even when name has no DSV token', async () => {
    const { svc } = forwarderRepo({
      forwarders: [{ id: 'f1', code: 'DSV001', name: 'Global Freight Partner Limited' }],
      forwarderAliases: [],
    })
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'DSV' })
    const hit = candidates.find((c) => c.code === 'DSV001')
    expect(hit).toBeTruthy()
    expect(hit!.signals).toContain('name:code')
  })
})
