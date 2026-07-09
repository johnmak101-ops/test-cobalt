import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createKysely } from '../src/db/kysely/mssql-dialect'
import { runMigrations } from '../src/db/kysely/migrate'
import { KyselyAlertRepository } from '../src/db/repositories/alert.repository.kysely'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import type { DB } from '../src/db/kysely/db.generated'

const URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'
const RUN = process.env.FABRIC_FOUNDATION === '1'

let db: Kysely<DB>
let repo: KyselyAlertRepository

beforeAll(async () => {
  if (!RUN) return
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
  await runMigrations(db, join(process.cwd(), 'kysely-migrations'))
  repo = new KyselyAlertRepository(db)
})
afterAll(async () => {
  if (!RUN) return
  await db.destroy()
})

async function seedRule(id = 'A1', severity = 'CRITICAL') {
  await repo.ensureRule({
    id, name: `Rule ${id}`, description: `desc ${id}`,
    triggerType: 'days_after', triggerReference: 'etd', watchFor: 'final_bl',
    thresholdHours: 48, severity,
  })
}

describe.runIf(RUN)('KyselyAlertRepository (SQL Server)', () => {
  it('enabledRules / allRules: returns rules, enabled filter narrows', async () => {
    await seedRule('B1', 'WARNING')
    await seedRule('B2', 'INFO')
    await repo.updateRule('B2', { enabled: false })
    const enabled = await repo.enabledRules()
    expect(enabled.map((r) => r.id)).toContain('B1')
    expect(enabled.map((r) => r.id)).not.toContain('B2')
    const all = await repo.allRules()
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining(['B1', 'B2']))
  })

  it('ensureRule is idempotent on the PK id', async () => {
    await seedRule('C1')
    const before = await repo.allRules()
    await seedRule('C1') // second insert must not throw
    const after = await repo.allRules()
    expect(after.filter((r) => r.id === 'C1').length).toBe(1)
    expect(after.length).toBe(before.length)
  })

  it('insertDeduped returns true once, false on a duplicate dedup_key', async () => {
    await seedRule('D1')
    const first = await repo.insertDeduped({
      ruleId: 'D1', severity: 'CRITICAL', message: 'm1', dedupKey: 'D1:s1', bookingId: null, shipmentId: null,
    })
    const second = await repo.insertDeduped({
      ruleId: 'D1', severity: 'CRITICAL', message: 'm1', dedupKey: 'D1:s1', bookingId: null, shipmentId: null,
    })
    expect(first).toBe(true)
    expect(second).toBe(false) // duplicate dedup_key → not new
  })

  it('insertDeduped with a distinct dedup_key inserts a second alert', async () => {
    await seedRule('E1')
    await repo.insertDeduped({ ruleId: 'E1', severity: 'WARNING', message: 'a', dedupKey: 'E1:s1' })
    const isNew = await repo.insertDeduped({ ruleId: 'E1', severity: 'WARNING', message: 'b', dedupKey: 'E1:s2' })
    expect(isNew).toBe(true)
  })

  it('list filters by status and orders newest-fired first', async () => {
    await seedRule('F1')
    await repo.insertDeduped({ ruleId: 'F1', severity: 'INFO', message: 'first', dedupKey: 'F1:1', firedAt: new Date('2026-01-01T00:00:00Z') })
    await repo.insertDeduped({ ruleId: 'F1', severity: 'INFO', message: 'second', dedupKey: 'F1:2', firedAt: new Date('2026-06-01T00:00:00Z') })
    const active = await repo.list('ACTIVE')
    expect(active.length).toBeGreaterThanOrEqual(2)
    // newest first
    expect(active[0].firedAt.getTime()).toBeGreaterThan(active[1].firedAt.getTime())
  })

  it('setStatus transitions ACTIVE → DISMISSED with extra fields', async () => {
    await seedRule('G1')
    await repo.insertDeduped({ ruleId: 'G1', severity: 'WARNING', message: 'm', dedupKey: 'G1:s1' })
    const all = await repo.list('ACTIVE')
    const target = all.find((a) => a.dedupKey === 'G1:s1')!
    const row = await repo.setStatus(target.id, 'DISMISSED', { dismissedAt: new Date('2026-07-01T00:00:00Z') })
    expect(row?.status).toBe('DISMISSED')
    expect(row?.dismissedAt).toBeTruthy()
    const active = await repo.list('ACTIVE')
    expect(active.find((a) => a.id === target.id)).toBeUndefined()
  })

  it('setReadAt stamps read_at without changing status', async () => {
    await seedRule('H1')
    await repo.insertDeduped({ ruleId: 'H1', severity: 'INFO', message: 'm', dedupKey: 'H1:s1' })
    const all = await repo.list('ACTIVE')
    const target = all.find((a) => a.dedupKey === 'H1:s1')!
    const at = new Date('2026-07-02T00:00:00Z')
    const row = await repo.setReadAt(target.id, at)
    expect(row?.readAt).toEqual(at)
    expect(row?.status).toBe('ACTIVE') // unchanged
    // clear it
    const cleared = await repo.setReadAt(target.id, null)
    expect(cleared?.readAt).toBeNull()
  })

  it('updateRule patches threshold/severity', async () => {
    await seedRule('I1')
    const row = await repo.updateRule('I1', { thresholdHours: 72, severity: 'CRITICAL' })
    expect(row?.thresholdHours).toBe(72)
    expect(row?.severity).toBe('CRITICAL')
    const rules = await repo.allRules()
    expect(rules.find((r) => r.id === 'I1')?.thresholdHours).toBe(72)
  })
})
