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

  it('emits name:exact so the queue can rank it above a sender-domain match (FOOWOO regression)', async () => {
    // Live 2026-07-27: the customs mail came from account@dgivy.cn, which is FOOWOO's contact domain.
    // The queue's hybrid resolver tested domain:exact first and auto-applied FOOWOO, discarding DGJAFA —
    // the same company the document actually names. Retrieval was always right; only the signal that
    // lets the resolver SEE "this is exactly the name" was missing.
    const { svc } = vendorRepo({
      vendors: [
        { code: 'DGJAFA', name: 'DONGGUAN CITY JIAFA FASHION CO., LTD.', type: 'factory', location: 'China', contactEmail: null, nameCh: '東莞市嘉發服飾有限公司' },
        { code: 'FOOWOO', name: 'FOOK TAI WOOL KNITTING LIMITED', type: 'factory', location: 'Hong Kong, SAR China', contactEmail: 'lilaixiang@dgivy.cn', nameCh: '福泰毛織有限公司' },
      ],
    })
    const { candidates } = await svc.candidates({
      type: 'vendor',
      name: '东莞市嘉发服饰有限公司',
      emailDomain: 'dgivy.cn',
    })
    expect(candidates.find((c) => c.code === 'DGJAFA')!.signals).toContain('name:exact')
    // FOOWOO keeps its domain signal — the queue decides precedence, retrieval only reports evidence
    const foowoo = candidates.find((c) => c.code === 'FOOWOO')
    expect(foowoo!.signals).toContain('domain:exact')
    expect(foowoo!.signals).not.toContain('name:exact')
  })

  it('a merely-similar name does NOT earn name:exact', async () => {
    const { svc } = vendorRepo({
      vendors: [{ code: 'SOUOCE', name: 'SOUTH OCEAN KNITTERS LTD', type: 'factory', location: null, contactEmail: null, nameCh: null }],
    })
    const { candidates } = await svc.candidates({ type: 'vendor', name: 'SOUTH OCEAN KNITTERS' })
    expect(candidates[0]!.signals.some((s) => s.startsWith('name:'))).toBe(true)
    expect(candidates[0]!.signals).not.toContain('name:exact')
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
    // One forwarder in the catalogue: rarity cannot mean anything at that size (1 of 1 is not rare),
    // so the reverse path stays off and this guarantee holds exactly as before. See
    // BRAND_RARITY_MIN_CATALOGUE; the recurring-token case is covered in the rarity describe below.
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

/**
 * The brand guard used to gate on LENGTH (≤6), so two real brands written as one long word were
 * refused for the same reason a city is: LOGIMARK and LXPANTOS are both 8 characters, exactly like
 * SHANGHAI. Measured on the dev forwarder catalogue, they are nothing alike:
 *
 *   LOGIMARK 1 · LX PANTOS 2 · LIGENTIA 8 · SHANGHAI 11 · HONG KONG 87
 *
 * so the ceiling is now REACH, not length.
 */
describe('CandidatesService — brand recall by rarity, not by length', () => {
  /** A catalogue big enough for "rare" to mean something, plus the rows under test. */
  function bigCatalogue(extra: { id: string; code: string | null; name: string }[]) {
    const filler = Array.from({ length: 40 }, (_, i) => ({
      id: `pad${i}`,
      code: `P${i}`,
      name: `PADDING FREIGHT ${i} INTERNATIONAL LIMITED`,
    }))
    return forwarderRepo({ forwarders: [...filler, ...extra], forwarderAliases: [] })
  }

  it('LOGIMARK (8 chars, one master) now surfaces its master', async () => {
    const { svc } = bigCatalogue([
      { id: 'f1', code: '794', name: 'Logimark International Limited Guangzhou' },
    ])
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'LOGIMARK' })
    expect(candidates.some((c) => c.code === '794')).toBe(true)
  })

  /**
   * LXPANTOS is NOT a token of "LX PANTOS …" — the master splits the word — so token-subset alone
   * could never have recovered it however the length gate was tuned. The squashed-prefix path does.
   */
  it('LXPantos surfaces LX PANTOS, which no token match could reach', async () => {
    const { svc } = bigCatalogue([
      { id: 'f1', code: '719', name: 'LX PANTOS LOGISTICS (SHENZHEN) CO. LTD' },
    ])
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'LXPantos' })
    expect(candidates.some((c) => c.code === '719')).toBe(true)
  })

  it('a token that recurs across the catalogue stays out, however long', async () => {
    const shanghais = Array.from({ length: 8 }, (_, i) => ({
      id: `s${i}`,
      code: `S${i}`,
      name: `SHANGHAI ${i} FREIGHT FORWARDING COMPANY LIMITED`,
    }))
    const { svc } = bigCatalogue(shanghais)
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'SHANGHAI' })
    expect(candidates).toHaveLength(0)
  })

  /** Rarity is a claim about a corpus. In a tiny one nothing is rare, so the old behaviour stands. */
  it('a small catalogue keeps the old refusal — 1 of 1 is not rare', async () => {
    const { svc } = forwarderRepo({
      forwarders: [{ id: 'f1', code: '794', name: 'Logimark International Limited Guangzhou' }],
      forwarderAliases: [],
    })
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'LOGIMARK' })
    expect(candidates).toHaveLength(0)
  })

  it('short brands are unaffected — DSV still reaches DSV001 in a big catalogue', async () => {
    const { svc } = bigCatalogue([{ id: 'f1', code: 'DSV001', name: 'DSV AIR AND SEA CO LTD' }])
    const { candidates } = await svc.candidates({ type: 'forwarder', name: 'DSV' })
    expect(candidates.some((c) => c.code === 'DSV001')).toBe(true)
  })
})
