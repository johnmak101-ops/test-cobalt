import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { MastersService } from '../src/masters/masters.service'

let db: TestDB
let masters: MastersService
let repo: ReturnType<typeof repos>['masters']
let adminId: string

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  const r = repos(db)
  repo = r.masters
  masters = new MastersService(r.masters)
})
// master_resolution facts must never leak into other int specs — clear explicitly (and on teardown), on top
// of resetDb's full wipe. created_by is a real users FK, so seed an admin each test (resetDb truncates users).
beforeEach(async () => {
  await resetDb(db)
  await db.deleteFrom('masterResolution').execute()
  const u = await db
    .insertInto('users')
    .values({ email: 'admin@cobalt.hk', name: 'Admin', passwordHash: 'x', role: 'ADMIN' })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
  adminId = u.id
})
afterAll(async () => {
  await db.deleteFrom('masterResolution').execute()
  await closeTestDb()
})

describe('MastersService — resolution curator CRUD (integration)', () => {
  it('create serves an active fact the consumer reads; deactivate hides it (manage still shows it)', async () => {
    const fact = await masters.createFact({ kind: 'customer_canonical', lhs: 'COLEB', rhs: 'COLE', reason: 'alias' }, adminId)
    expect(fact).toBeTruthy()

    // consumer read (what cobalt-queue's parser sees): the canonical fold resolves COLEB → COLE
    expect(await repo.canonicalCode('COLEB')).toBe('COLE')
    // the serve list (approved + active) includes it
    expect((await masters.resolution()).some((f) => f.lhs === 'COLEB' && f.rhs === 'COLE')).toBe(true)

    await masters.deactivate(fact!.id)
    expect(await repo.canonicalCode('COLEB')).toBe('COLEB') // fact off → falls back to the input code
    expect((await masters.resolution()).some((f) => f.lhs === 'COLEB')).toBe(false) // consumer hides it
    const managed = await masters.resolutionManage()
    expect(managed.find((f) => f.lhs === 'COLEB')?.active).toBe(false) // admin view still shows it, deactivated
  })

  it('enforces the single-active invariant: a new fact for the same (kind,lhs) supersedes the old', async () => {
    await masters.createFact({ kind: 'customer_group', lhs: 'SEH', rhs: 'PRIMARK' }, adminId)
    await masters.createFact({ kind: 'customer_group', lhs: 'SEH', rhs: 'NEXTGRP' }, adminId)

    expect(await repo.customerGroupOf('SEH')).toBe('NEXTGRP') // only the newest is active
    const activeSeh = (await masters.resolution()).filter((f) => f.kind === 'customer_group' && f.lhs === 'SEH')
    expect(activeSeh).toHaveLength(1)
    expect(activeSeh[0]!.rhs).toBe('NEXTGRP')
  })

  it('reactivate restores a deactivated fact', async () => {
    const a = await masters.createFact({ kind: 'customer_canonical', lhs: 'DOCC', rhs: 'DOCLASSE' }, adminId)
    await masters.deactivate(a!.id)
    expect(await repo.canonicalCode('DOCC')).toBe('DOCC')
    await masters.reactivate(a!.id)
    expect(await repo.canonicalCode('DOCC')).toBe('DOCLASSE')
  })
})
