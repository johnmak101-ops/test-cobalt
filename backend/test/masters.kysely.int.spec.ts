import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { MastersRepository } from '../src/db/repositories/masters.repository'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'


let db: Kysely<DB>
let repo: MastersRepository

beforeAll(async () => {
  db = createKysely<DB>(URL)
  repo = new MastersRepository(db)
  // reset dbo (drop FKs, tables, ledger) + migrate
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
FROM sys.foreign_keys fk JOIN sys.tables t ON fk.parent_object_id = t.object_id
WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'DROP TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';'
FROM sys.tables t WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db).catch(() => {})
  await runMigrations(db, join(process.cwd(), 'src/db/kysely-migrations'))
})
afterAll(async () => {
  await db.destroy()
})

async function reset() {
  // truncate the masters tables (FK-child-first where relevant); master_resolution has no FKs into these.
  await db.deleteFrom('masterResolution').execute()
  await db.deleteFrom('forwarderAliases').execute()
  await db.deleteFrom('consignees').execute()
  await db.deleteFrom('ports').execute()
  await db.deleteFrom('forwarders').execute()
  await db.deleteFrom('vendors').execute()
  await db.deleteFrom('customers').execute()
  await db.deleteFrom('users').execute()
}

describe('MastersRepository (SQL Server)', () => {
  beforeEach(async () => {
    await reset()
  })

  it('listCustomers / insertCustomers / updateCustomer round-trip with country + contactEmail', async () => {
    await repo.insertCustomers([{ code: 'WYSE', name: 'Wyse Co', country: 'Hong Kong', contactEmail: 'ops@wyse.com', address: 'KT', erpSyncedAt: new Date() }])
    const rows = await repo.listCustomers()
    expect(rows.map((r) => r.code)).toContain('WYSE')
    const wyse = rows.find((r) => r.code === 'WYSE')!
    expect(wyse).toMatchObject({ name: 'Wyse Co', country: 'Hong Kong', contactEmail: 'ops@wyse.com', address: 'KT' })

    // update changes name + fields
    await repo.updateCustomer(wyse.id, { name: 'Wyse Ltd', country: 'Vietnam', contactEmail: 'new@wyse.com', address: 'Hanoi', erpSyncedAt: new Date() })
    const after = await repo.listCustomers()
    expect(after.find((r) => r.code === 'WYSE')).toMatchObject({ name: 'Wyse Ltd', country: 'Vietnam', contactEmail: 'new@wyse.com' })
  })

  it('customerIdByCode / customerByCode resolve by exact code (uppercase)', async () => {
    await repo.insertCustomers([{ code: 'COLE', name: 'Cole Ltd', country: null, contactEmail: null, address: null, erpSyncedAt: new Date() }])
    const byId = await repo.customerIdByCode('cole')
    expect(byId).toBeTruthy()
    const byObj = await repo.customerByCode('COLE')
    expect(byObj?.code).toBe('COLE')
  })

  it('forwarderIdByName runs the full staged tiers (exact, alias, stripped-annotation, ambiguity-guarded)', async () => {
    const fwd = await db.insertInto('forwarders').values({ code: 'EXP', name: 'EXPEDITORS INTERNATIONAL' }).output('inserted.id').executeTakeFirstOrThrow()
    await db.insertInto('forwarderAliases').values({ forwarderId: fwd.id, aliasType: 'name', value: 'EXPEDITORS' }).execute()

    // exact master name
    expect(await repo.forwarderIdByName('EXPEDITORS INTERNATIONAL')).toBe(fwd.id)
    // exact alias
    expect(await repo.forwarderIdByName('EXPEDITORS')).toBe(fwd.id)
    // office annotation stripped → normalized-exact tier ('(LAX)' is not part of the name)
    expect(await repo.forwarderIdByName('Expeditors International (LAX)')).toBe(fwd.id)
    // single containment hit resolves (exactly-one guard) — the tiers ARE ported (the LLM matcher
    // that replaces them is deferred behind this migration)
    expect(await repo.forwarderIdByName('Expeditors (LAX)')).toBe(fwd.id)
    // no match → null (an unresolved name surfaces as forwarder_raw)
    expect(await repo.forwarderIdByName('some unrelated name')).toBeNull()
    // legal-form DANGER pair: two masters that differ ONLY by legal form must NOT resolve
    // nondeterministically — the exactly-one fold guard returns null
    await db.insertInto('forwarders').values([
      { code: 'AGI1', name: 'AGILITY LOGISTICS LTD' },
      { code: 'AGI2', name: 'AGILITY LOGISTICS LIMITED' },
    ]).execute()
    expect(await repo.forwarderIdByName('Agility Logistics')).toBeNull()
  })

  it('portByCodeOrName resolves by exact UN/LOCODE and exact IATA', async () => {
    const p = await db.insertInto('ports').values({ unlocode: 'CNYTN', name: 'Yantian', country: 'CN', mode: 'sea', iata: 'YTN' }).output('inserted.id').executeTakeFirstOrThrow()
    const byUnlocode = await repo.portByCodeOrName('cnytn')
    expect(byUnlocode?.id).toBe(p.id)
    expect(byUnlocode?.country).toBe('CN')
    // bare 3-char IATA
    const byIata = await repo.portByCodeOrName('YTN')
    expect(byIata?.id).toBe(p.id)
  })

  it('resolution curator CRUD: create/canonicalCode/deactivate', async () => {
    const u = await db.insertInto('users').values({ email: 'a@b.co', name: 'A', passwordHash: 'x', role: 'ADMIN' }).output('inserted.id').executeTakeFirstOrThrow()
    const fact = await repo.insertOpsFact({ kind: 'customer_canonical', lhs: 'COLEB', rhs: 'COLE', reason: 'alias', createdBy: u.id })
    expect(fact).toBeTruthy()
    expect(await repo.canonicalCode('COLEB')).toBe('COLE')

    // deactivate hides it from the consumer read (canonicalCode falls back to the input)
    await repo.setActive(fact!.id, false)
    expect(await repo.canonicalCode('COLEB')).toBe('COLEB')
  })

  it('listResolution serves only approved+active; listResolutionManage serves all approved', async () => {
    const u = await db.insertInto('users').values({ email: 'a@b.co', name: 'A', passwordHash: 'x', role: 'ADMIN' }).output('inserted.id').executeTakeFirstOrThrow()
    const f1 = await repo.insertOpsFact({ kind: 'customer_canonical', lhs: 'X', rhs: 'Y', reason: null, createdBy: u.id })!
    await repo.insertOpsFact({ kind: 'customer_canonical', lhs: 'X2', rhs: 'Y2', reason: null, createdBy: u.id })
    await repo.setActive(f1!.id, false)

    const served = await repo.listResolution('approved')
    expect(served.some((f) => f.lhs === 'X')).toBe(false) // deactivated → not served
    expect(served.some((f) => f.lhs === 'X2')).toBe(true)
    const managed = await repo.listResolutionManage()
    expect(managed.some((f) => f.lhs === 'X')).toBe(true) // manage shows deactivated ones too
  })

  describe('forwarderIdByCode (exactly-one, case-insensitive)', () => {
    it('links an exact code and rejects unknown', async () => {
      const fwd = await db.insertInto('forwarders').values({ code: 'DSVAIR', name: 'DSV AIR & SEA CO LTD' }).output('inserted.id').executeTakeFirstOrThrow()
      expect(await repo.forwarderIdByCode('dsvair')).toBe(fwd.id)
      expect(await repo.forwarderIdByCode('NOPE99')).toBeNull()
      expect(await repo.forwarderIdByCode('')).toBeNull()
    })
  })

  describe('forwarderLinkByName tier attribution', () => {
    it('normalized-exact reports norm_exact; containment reports containment', async () => {
      const fwd = await db.insertInto('forwarders').values({ code: 'LXP001', name: 'LX PANTOS LOGISTICS (SHENZHEN) CO. LTD' }).output('inserted.id').executeTakeFirstOrThrow()
      const exact = await repo.forwarderLinkByName('LX PANTOS LOGISTICS (SHENZHEN) CO.,LTD.')
      expect(exact).toEqual({ id: fwd.id, tier: 'norm_exact' })
      const contained = await repo.forwarderLinkByName('PANTOS LOGISTICS (SHENZHEN)')
      expect(contained?.tier).toBe('containment')
    })
    it('forwarderIdByName wrapper still returns the bare id', async () => {
      const fwd = await db.insertInto('forwarders').values({ code: 'WRAP01', name: 'WRAPPER TEST FORWARDER LIMITED' }).output('inserted.id').executeTakeFirstOrThrow()
      expect(await repo.forwarderIdByName('WRAPPER TEST FORWARDER LIMITED')).toBe(fwd.id)
    })
  })

  describe('portIdByUnlocode (strict shape + exact)', () => {
    it('resolves only a real UN/LOCODE', async () => {
      await db.insertInto('ports').values({ unlocode: 'CNSHK', name: 'Shekou', country: 'CN', mode: 'sea' }).execute()
      expect(await repo.portIdByUnlocode('CNSHK')).toBeTruthy()
      expect(await repo.portIdByUnlocode('SHEKOU')).toBeNull() // not UN/LOCODE-shaped
      expect(await repo.portIdByUnlocode('XXXXX')).toBeNull() // shaped but absent
    })
  })
})
