import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { SettingsRepository } from '../src/db/repositories/settings.repository'
import { UsersRepository, LastActiveSuperadminError } from '../src/db/repositories/users.repository'
import { AuditRepository } from '../src/db/repositories/audit.repository'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

let db: Kysely<DB>
let settings: SettingsRepository
let users: UsersRepository
let audit: AuditRepository

beforeAll(async () => {
  db = createKysely<DB>(URL)
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'ALTER TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N' DROP CONSTRAINT ' + QUOTENAME(fk.name) + N';'
FROM sys.foreign_keys fk JOIN sys.tables t ON fk.parent_object_id = t.object_id WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`
DECLARE @sql NVARCHAR(MAX) = N''
SELECT @sql = @sql + N'DROP TABLE ' + QUOTENAME(schema_name(t.schema_id)) + N'.' + QUOTENAME(t.name) + N';'
FROM sys.tables t WHERE schema_name(t.schema_id) = 'dbo'
EXEC sp_executesql @sql`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration`.execute(db).catch(() => {})
  await sql`DROP TABLE IF EXISTS kysely_migration_lock`.execute(db).catch(() => {})
  await runMigrations(db, join(process.cwd(), 'src/db/kysely-migrations'))
  settings = new SettingsRepository(db)
  users = new UsersRepository(db)
  audit = new AuditRepository(db)
})
afterAll(async () => {
  await db.destroy()
})

async function reset() {
  await db.deleteFrom('changeLog').execute()
  await db.deleteFrom('appSettings').execute()
  await db.deleteFrom('users').execute()
}

describe('Kysely leaf repos (SQL Server)', () => {
  beforeEach(async () => {
    await reset()
  })

  // ---- SettingsRepository ----
  it('settings: get returns null when absent; set upserts (insert then update)', async () => {
    expect(await settings.get('missing')).toBeNull()
    await settings.set('threshold', 85)
    expect(await settings.get<number>('threshold')).toBe(85)
    await settings.set('threshold', 90) // update, not duplicate
    expect(await settings.get<number>('threshold')).toBe(90)
    const rows = await db.selectFrom('appSettings').select('key').execute()
    expect(rows.length).toBe(1)
  })

  // ---- UsersRepository ----
  it('users: findByEmail (lowercase) / findById / create / list / update / countActiveByRole', async () => {
    const u = await users.create({ email: 'Admin@Co.co', name: 'Admin', passwordHash: 'x', role: 'ADMIN' })
    expect(u).toBeTruthy()
    expect(await users.findByEmail('admin@co.co')).toBeTruthy() // lowercased lookup
    expect(await users.findById(u!.id)).toBeTruthy()
    await users.create({ email: 'v@co.co', name: 'V', passwordHash: 'x', role: 'VIEWER' })
    expect((await users.list()).length).toBe(2)
    expect(await users.countActiveByRole('ADMIN')).toBe(1)
    await users.update(u!.id, { role: 'VIEWER' })
    expect(await users.countActiveByRole('ADMIN')).toBe(0)
  })

  it('users: updateGuardingLastActiveSuperadmin throws when only one remains', async () => {
    const s1 = await users.create({ email: 's1@co.co', name: 'S1', passwordHash: 'x', role: 'SUPERADMIN' })!
    await expect(users.updateGuardingLastActiveSuperadmin(s1.id, { active: false })).rejects.toThrow(LastActiveSuperadminError)
    // with two, demoting one succeeds
    await users.create({ email: 's2@co.co', name: 'S2', passwordHash: 'x', role: 'SUPERADMIN' })
    const after = await users.updateGuardingLastActiveSuperadmin(s1.id, { active: false })
    expect(after?.active).toBe(false)
  })

  // ---- AuditRepository ----
  it('audit: write + listForEntity (newest-first by seq, excludes shadow rows)', async () => {
    const eId = '00000000-0000-0000-0000-000000000001'
    await audit.write({ entityType: 'shipment', entityId: eId, changeType: 'create', sourceType: 'email', field: null, oldValue: null, newValue: 'A' })
    await audit.write({ entityType: 'shipment', entityId: eId, changeType: 'update', sourceType: 'manual', field: 'eta', oldValue: '1', newValue: '2' })
    await audit.write({ entityType: 'shipment', entityId: eId, changeType: 'shadow', sourceType: 'system', field: 'x', oldValue: null, newValue: 'Y' })

    const rows = await audit.listForEntity('shipment', eId)
    expect(rows.length).toBe(2) // shadow excluded
    expect(rows[0]!.changeType).toBe('update') // newest first (seq desc)
    expect(rows[1]!.changeType).toBe('create')
  })
})
