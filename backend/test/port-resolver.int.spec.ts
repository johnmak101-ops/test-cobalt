import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import type { MastersRepository } from '../src/db/repositories/masters.repository'

let db: TestDB
let masters: MastersRepository

// The adversarial slice of the real master: short port names that sit mid-word inside common inputs
// ('Tago' ⊂ 'Chittagong', 'China' ⊂ 'QINGDAO, CHINA') alongside the real targets + a decorated input.
const PORTS = [
  { unlocode: 'JPTAO', name: 'Tago', country: 'JP', mode: 'sea' as const, iata: null },
  { unlocode: 'JPCHI', name: 'China', country: 'JP', mode: 'sea' as const, iata: null },
  { unlocode: 'BDCGP', name: 'Chattogram', country: 'BD', mode: 'both' as const, iata: 'CGP' },
  { unlocode: 'CNQIN', name: 'Qingdao', country: 'CN', mode: 'both' as const, iata: null },
  { unlocode: 'CNSGH', name: 'Shanghai', country: 'CN', mode: 'both' as const, iata: null },
  { unlocode: 'CNSHZ', name: 'Shanghai Railway Station', country: 'CN', mode: 'sea' as const, iata: null },
  { unlocode: 'NLRTM', name: 'Rotterdam', country: 'NL', mode: 'both' as const, iata: 'RTM' },
  { unlocode: 'KHPNH', name: 'Phnom Penh', country: 'KH', mode: 'both' as const, iata: 'PNH' },
  { unlocode: 'PGLHP', name: 'Lehu', country: 'PG', mode: 'sea' as const, iata: null },
  { unlocode: 'SOHCM', name: 'Eil', country: 'SO', mode: 'sea' as const, iata: 'HCM' },
  { unlocode: 'VNSGN', name: 'Ho Chi Minh City', country: 'VN', mode: 'both' as const, iata: 'SGN' },
]

// The curated tiers are DATA now (master_resolution port_* kinds, seeded from the former hardcoded
// tables) — the spec seeds the same facts the production seed ships, pinning the data-driven behavior.
const PORT_FACTS = [
  { kind: 'port_abbreviation', lhs: 'HCM', rhs: 'VNSGN' },
  { kind: 'port_alias', lhs: 'GOTEBORG', rhs: 'SEGOT' },
  { kind: 'port_iata', lhs: 'PNH', rhs: 'KHPNH' },
  { kind: 'port_fragment', lhs: 'CHITTAGONG', rhs: 'BDCGP' },
  { kind: 'port_fragment', lhs: 'CHATTOGRAM', rhs: 'BDCGP' },
].map((f) => ({ ...f, status: 'approved', source: 'seed', reason: null }))

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  masters = repos(db).masters
})
afterAll(closeTestDb)
beforeEach(async () => {
  await resetDb(db)
  await db.insertInto('ports').values(PORTS).execute()
  await db.insertInto('masterResolution').values(PORT_FACTS as never).execute()
})

const codeOf = async (input: string): Promise<string | null> => {
  const r = await masters.portByCodeOrName(input)
  if (!r) return null
  const p = await db.selectFrom('ports').selectAll().where('id', '=', r.id).executeTakeFirst()
  return p?.unlocode ?? null
}

describe('portByCodeOrName — forward-only fuzzy, curated aliases before the fuzzy match', () => {
  it("'Chittagong' resolves to Bangladesh BDCGP, NOT Japan 'Tago' (the JPTAO regression)", async () => {
    expect(await codeOf('Chittagong')).toBe('BDCGP')
    expect((await masters.portByCodeOrName('Chittagong'))?.country).toBe('BD')
  })

  it("decorated 'QINGDAO, CHINA' → Qingdao, not the JP port literally named 'China'", async () => {
    expect(await codeOf('QINGDAO, CHINA')).toBe('CNQIN')
  })

  it("'SHANGHAI' → the city entry, not 'Shanghai Railway Station' (shortest official name wins)", async () => {
    expect(await codeOf('SHANGHAI')).toBe('CNSGH')
  })

  it('exact UN/LOCODE and bare IATA still win', async () => {
    expect(await codeOf('NLRTM')).toBe('NLRTM')
    expect(await codeOf('CGP')).toBe('BDCGP') // bare IATA → Chattogram
    expect(await codeOf('PNH')).toBe('KHPNH') // bare IATA → Phnom Penh
  })

  it('an unresolvable port returns null — a miss, never a wrong guess', async () => {
    expect(await masters.portByCodeOrName('Nowhereville')).toBeNull()
  })

  it("a 3-char junk token does not hijack a longer name ('EHU' must NOT match 'L·ehu·')", async () => {
    expect(await masters.portByCodeOrName('EHU')).toBeNull()
  })

  it("'HCM' pins to Ho Chi Minh (VNSGN), not the obscure Somali port that literally owns IATA 'HCM'", async () => {
    expect(await codeOf('HCM')).toBe('VNSGN')
  })

  it('the tiers are LIVE data: an ADMIN-created fact takes effect immediately, deactivation reverts it', async () => {
    await db.insertInto('ports').values({ unlocode: 'SEGOT', name: 'Gothenburg', country: 'SE', mode: 'both' }).execute()
    // 'GOTEBORG' fact is seeded → resolves; a brand-new runtime fact works the same way
    expect(await codeOf('GOTEBORG')).toBe('SEGOT')
    const fact = await masters.insertOpsFact({ kind: 'port_alias', lhs: 'GBG', rhs: 'SEGOT', reason: 'ops shorthand', createdBy: null })
    expect(await codeOf('GBG')).toBe('SEGOT')
    await masters.setActive((fact as { id: string }).id, false)
    expect(await masters.portByCodeOrName('GBG')).toBeNull() // deactivated → a miss again, never a stale hit
  })
})

describe('carriers master (the SCAC data home)', () => {
  it('create normalizes SCAC to uppercase; byScac is case-insensitive; list orders by scac', async () => {
    await masters.createCarrier({ scac: 'maeu', name: 'Maersk Line' })
    await masters.createCarrier({ scac: 'MSCU', name: 'MSC' })
    const hit = await masters.carrierByScac('maeu')
    expect(hit).toMatchObject({ scac: 'MAEU', name: 'Maersk Line' })
    expect((await masters.listCarriers()).map((c) => c.scac)).toEqual(['MAEU', 'MSCU'])
    expect(await masters.carrierByScac('ZZZZ')).toBeNull()
  })

  it('SCAC is unique — a duplicate create fails loudly', async () => {
    await masters.createCarrier({ scac: 'ONEY', name: 'Ocean Network Express' })
    await expect(masters.createCarrier({ scac: 'oney', name: 'dupe' })).rejects.toThrow(/unique|duplicate/i)
  })
})
