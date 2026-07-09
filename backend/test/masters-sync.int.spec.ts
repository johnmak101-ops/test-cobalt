import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { MastersSyncService } from '../src/masters/mesh/masters-sync.service'
import type { MeshMasterSource } from '../src/masters/mesh/mesh.types'

let db: TestDB
let repo: ReturnType<typeof repos>['masters']

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  repo = repos(db).masters
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

const source = (over: Partial<MeshMasterSource> = {}): MeshMasterSource => ({
  customers: async () => [],
  vendors: async () => [],
  forwarders: async () => [],
  ...over,
})

describe('MastersSyncService (integration)', () => {
  it('inserts new, updates changed, and NEVER deletes a local row missing from the pull', async () => {
    await db.insertInto('customers').values([{ code: 'OLD', name: 'Old Name' }, { code: 'GONE', name: 'Not In ERP' }]).execute()
    const svc = new MastersSyncService(source({
      customers: async () => [{ code: 'OLD', name: 'New Name' }, { code: 'NEW', name: 'Fresh' }],
    }), repo)
    const [cust] = await svc.sync()
    expect(cust).toMatchObject({ type: 'customers', fetched: 2, inserted: 1, updated: 1 })
    const rows = await db.selectFrom('customers').selectAll().execute()
    expect(rows.map((r) => `${r.code}:${r.name}`).sort()).toEqual(['GONE:Not In ERP', 'NEW:Fresh', 'OLD:New Name'])
  })

  it('is idempotent — a second sync with the same data changes nothing', async () => {
    const svc = new MastersSyncService(source({ customers: async () => [{ code: 'A', name: 'Acme' }] }), repo)
    await svc.sync()
    const [second] = await svc.sync()
    expect(second).toMatchObject({ inserted: 0, updated: 0 })
  })

  it('persists + refreshes customer country/contactEmail/address (matcher Phase 0 enrichment)', async () => {
    const v1 = { code: 'ENR', name: 'Enriched Ltd', country: 'Hong Kong', contactEmail: 'ops@enriched.hk', address: '9 Queen Rd' }
    const svc1 = new MastersSyncService(source({ customers: async () => [v1] }), repo)
    await svc1.sync()
    let row = await db.selectFrom('customers').selectAll().where('code', '=', 'ENR').executeTakeFirstOrThrow()
    expect(row).toMatchObject({ country: 'Hong Kong', contactEmail: 'ops@enriched.hk', address: '9 Queen Rd' })

    // an enrichment-only change (same name) must count as an update and refresh the row
    const svc2 = new MastersSyncService(source({ customers: async () => [{ ...v1, contactEmail: 'buy@enriched.hk' }] }), repo)
    const [cust] = await svc2.sync()
    expect(cust).toMatchObject({ inserted: 0, updated: 1 })
    row = await db.selectFrom('customers').selectAll().where('code', '=', 'ENR').executeTakeFirstOrThrow()
    expect(row.contactEmail).toBe('buy@enriched.hk')

    // and it stays idempotent afterwards
    const [again] = await svc2.sync()
    expect(again).toMatchObject({ inserted: 0, updated: 0 })
  })

  it('lands factories + gmtsuppliers in vendors with the right type', async () => {
    const svc = new MastersSyncService(source({
      vendors: async () => [
        { code: 'F1', name: 'Fac', type: 'factory', location: 'CN', contactEmail: null, contactPhone: null },
        { code: 'G1', name: 'Sup', type: 'agent', location: 'CN', contactEmail: null, contactPhone: null },
      ],
    }), repo)
    await svc.sync()
    const rows = await db.selectFrom('vendors').selectAll().execute()
    expect(rows.map((r) => `${r.code}:${r.type}`).sort()).toEqual(['F1:factory', 'G1:agent'])
  })

  it('isolates a per-type failure — customers still sync when vendors throws', async () => {
    const svc = new MastersSyncService(source({
      customers: async () => [{ code: 'A', name: 'Acme' }],
      vendors: async () => { throw new Error('mesh 500') },
    }), repo)
    const summary = await svc.sync()
    expect(summary.find((s) => s.type === 'customers')).toMatchObject({ inserted: 1 })
    expect(summary.find((s) => s.type === 'vendors')?.error).toMatch(/mesh 500/)
    expect(await db.selectFrom('customers').selectAll().execute()).toHaveLength(1)
  })
})
