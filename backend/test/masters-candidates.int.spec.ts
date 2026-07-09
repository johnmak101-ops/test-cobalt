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

describe('Phase 2 co-occurrence / brand signals', () => {
  it('cooccur:po — a context PO pins its buyer above a same-name competitor', async () => {
    const c1 = await db.insertInto('customers').values({ code: 'ACMHK', name: 'ACME TRADING', country: null, contactEmail: null }).output('inserted.id').executeTakeFirstOrThrow()
    await db.insertInto('customers').values({ code: 'ACMVN', name: 'ACME TRADING', country: null, contactEmail: null }).execute()
    await db.insertInto('purchaseOrders').values({ poNumber: 'PO-777', customerId: c1.id }).execute()
    const { candidates } = await svc().candidates({ type: 'customer', name: 'ACME TRADING', context: { poNumbers: ['PO-777'] } })
    expect(candidates[0]).toMatchObject({ code: 'ACMHK' })
    expect(candidates[0]!.signals).toContain('cooccur:po')
    expect(candidates.map((c) => c.code)).toContain('ACMVN') // boost, never a filter
  })

  it('cooccur:customer + related:customer_vendor — history and curated facts lift a vendor', async () => {
    const cust = await db.insertInto('customers').values({ code: 'WYSE', name: 'WYSE GROUP', country: null, contactEmail: null }).output('inserted.id').executeTakeFirstOrThrow()
    const v1 = await db.insertInto('vendors').values({ code: 'MACFUN', name: 'GOLDEN GARMENTS FTY', type: 'factory', location: null }).output('inserted.id').executeTakeFirstOrThrow()
    await db.insertInto('vendors').values({ code: 'OTHER', name: 'GOLDEN GARMENTS FTY', type: 'factory', location: null }).execute()
    await db.insertInto('bookings').values({ jobNo: 'JOB-CO-1', customerId: cust.id, vendorId: v1.id }).execute()
    await masters.insertOpsFact({ kind: 'customer_vendor', lhs: 'WYSE', rhs: 'MACFUN', reason: null, createdBy: null })
    const { candidates } = await svc().candidates({ type: 'vendor', name: 'GOLDEN GARMENTS FTY', context: { customerCode: 'WYSE' } })
    expect(candidates[0]).toMatchObject({ code: 'MACFUN' })
    expect(candidates[0]!.signals).toEqual(expect.arrayContaining(['cooccur:customer', 'related:customer_vendor']))
    expect(candidates.map((c) => c.code)).toContain('OTHER')
  })

  it('brand:match — a context brand lifts the customer whose POs carry it', async () => {
    const c1 = await db.insertInto('customers').values({ code: 'PRIM', name: 'GLOBAL RETAIL', country: null, contactEmail: null }).output('inserted.id').executeTakeFirstOrThrow()
    await db.insertInto('customers').values({ code: 'GLOB', name: 'GLOBAL RETAIL', country: null, contactEmail: null }).execute()
    await db.insertInto('purchaseOrders').values({ poNumber: 'PO-BR-1', customerId: c1.id, brand: 'Primark' }).execute()
    const { candidates } = await svc().candidates({ type: 'customer', name: 'GLOBAL RETAIL', context: { brand: 'primark' } })
    expect(candidates[0]).toMatchObject({ code: 'PRIM' })
    expect(candidates[0]!.signals).toContain('brand:match')
  })

  it('a context-only hit (no name/domain signal) still surfaces as a candidate', async () => {
    const cust = await db.insertInto('customers').values({ code: 'WYSE', name: 'WYSE GROUP', country: null, contactEmail: null }).output('inserted.id').executeTakeFirstOrThrow()
    const v1 = await db.insertInto('vendors').values({ code: 'MACFUN', name: 'MACAU FUNG TAI CO LTD', type: 'factory', location: null }).output('inserted.id').executeTakeFirstOrThrow()
    await db.insertInto('bookings').values({ jobNo: 'JOB-CO-2', customerId: cust.id, vendorId: v1.id }).execute()
    const { candidates } = await svc().candidates({ type: 'vendor', name: 'COMPLETELY UNRELATED NAME', context: { customerCode: 'WYSE' } })
    expect(candidates.map((c) => c.code)).toContain('MACFUN')
  })
})
