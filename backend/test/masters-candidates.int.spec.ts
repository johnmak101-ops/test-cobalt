import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { CandidatesService } from '../src/masters/candidates.service'
import { MastersService } from '../src/masters/masters.service'

let db: TestDB
let masters: ReturnType<typeof repos>['masters']

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  masters = repos(db).masters
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

// a fresh service per test — its 60s row cache must not leak across reseeds
const svc = () => new CandidatesService(masters)

describe('POST /masters/candidates retrieval (integration)', () => {
  it('finds a vendor by trigram name similarity; unrelated names stay out', async () => {
    await db.insertInto('vendors').values([
      { code: 'MACFUN', name: 'MACAU FUNG TAI CO LTD', type: 'factory', location: 'Macau' },
      { code: 'ROYAL', name: 'ROYAL KNITWEAR FACTORY', type: 'factory', location: 'China' },
    ]).execute()
    const { candidates } = await svc().candidates({ type: 'vendor', name: 'MACAU FUNG TAI LTD' })
    expect(candidates.map((c) => c.code)).toEqual(['MACFUN'])
    expect(candidates[0]!.signals.some((s) => s.startsWith('name:'))).toBe(true)
    expect(candidates[0]!.score).toBeGreaterThan(0.5)
  })

  it('domain:exact (forwarder alias) outranks a name-similar competitor', async () => {
    const f1 = await db.insertInto('forwarders').values({ code: 'EXP', name: 'EXPEDITORS INTERNATIONAL' }).output('inserted.id').executeTakeFirstOrThrow()
    await db.insertInto('forwarders').values({ code: 'EXPC', name: 'EXPEDITORS CAMBODIA' }).execute()
    await db.insertInto('forwarderAliases').values({ forwarderId: f1.id, aliasType: 'domain', value: 'expeditors.com' }).execute()
    const { candidates } = await svc().candidates({ type: 'forwarder', name: 'Expeditors Cambodia', emailDomain: 'expeditors.com' })
    // the name-similar EXPC scores high on trigram, but the exact domain pins EXP to the top
    expect(candidates[0]!.code).toBe('EXP')
    expect(candidates[0]!.signals).toContain('domain:exact')
    expect(candidates.map((c) => c.code)).toContain('EXPC')
  })

  it('region matches boost (never filter): same-name customers order by country match', async () => {
    await db.insertInto('customers').values([
      { code: 'ACMHK', name: 'ACME TRADING', country: 'Hong Kong', contactEmail: null },
      { code: 'ACMVN', name: 'ACME TRADING', country: 'Vietnam', contactEmail: null },
    ]).execute()
    const { candidates } = await svc().candidates({ type: 'customer', name: 'ACME TRADING', country: 'hong kong' })
    expect(candidates.map((c) => c.code)).toEqual(['ACMHK', 'ACMVN']) // VN still present — boost, not filter
    expect(candidates[0]!.signals).toContain('region:match')
  })

  it('a prior_correction fact surfaces its code even with zero name similarity (top-rank boost)', async () => {
    await db.insertInto('customers').values({ code: 'WYSE', name: 'WYSE GROUP HOLDINGS', country: null, contactEmail: null }).execute()
    await masters.insertOpsFact({ kind: 'prior_correction', lhs: 'TOTALLY DIFFERENT RAW NAME', rhs: 'WYSE', reason: 'human correction', createdBy: null })
    const { candidates } = await svc().candidates({ type: 'customer', name: 'TOTALLY DIFFERENT RAW NAME' })
    expect(candidates.map((c) => c.code)).toEqual(['WYSE'])
    expect(candidates[0]!.signals).toContain('prior_correction')
  })

  it('customer contactEmail domain matches (Phase 0 enrichment feeding retrieval)', async () => {
    await db.insertInto('customers').values({ code: '2TAL', name: '2TALL.COM RETAIL LIMITED', country: 'United Kingdom', contactEmail: 'buy@2tall.com' }).execute()
    const { candidates } = await svc().candidates({ type: 'customer', emailDomain: '2tall.com' })
    expect(candidates.map((c) => c.code)).toEqual(['2TAL'])
    expect(candidates[0]!.signals).toContain('domain:exact')
  })

  it('respects the limit and scopes by type', async () => {
    await db.insertInto('customers').values(
      Array.from({ length: 5 }, (_, i) => ({ code: `C${i}`, name: `GLOBAL GARMENTS ${i}`, country: null, contactEmail: null })),
    ).execute()
    await db.insertInto('vendors').values({ code: 'VGG', name: 'GLOBAL GARMENTS FACTORY', type: 'factory', location: null }).execute()
    const { candidates } = await svc().candidates({ type: 'customer', name: 'GLOBAL GARMENTS', limit: 3 })
    expect(candidates).toHaveLength(3)
    expect(candidates.every((c) => c.type === 'customer')).toBe(true)
  })

  it('consumer GET /masters/resolution hides prior_correction; the manage view still shows it', async () => {
    await masters.insertOpsFact({ kind: 'prior_correction', lhs: 'raw name', rhs: 'CODE1', reason: null, createdBy: null })
    await masters.insertOpsFact({ kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK', reason: null, createdBy: null })
    const service = new MastersService(masters)
    const consumer = await service.resolution()
    expect(consumer.map((f) => f.kind)).toEqual(['customer_group'])
    const manage = await service.resolutionManage()
    expect(manage.map((f) => f.kind).sort()).toEqual(['customer_group', 'prior_correction'])
  })
})
