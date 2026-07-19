import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { PageAccessService } from '../src/access/page-access.service'

let db: TestDB
let access: PageAccessService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  access = new PageAccessService(repos(db).settings)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('PageAccessService (integration — real app_settings round-trip)', () => {
  it('serves registry defaults when nothing is stored', async () => {
    expect(await access.levelFor('alert_rules', 'VIEWER')).toBe('view')
    expect(await access.levelFor('alert_rules', 'ADMIN')).toBe('edit')
    // resolution_rules retired from matrix → none for non-superadmin
    expect(await access.levelFor('resolution_rules', 'ADMIN')).toBe('none')
  })

  it('persists overrides to app_settings and reads them back (JSONB round-trip), superadmin still edit', async () => {
    // updatedBy is a nullable uuid FK; the controller passes the real actor.id, the test passes null.
    await access.setMatrix({ alert_rules: { VIEWER: 'none', EDITOR: 'edit' } }, null)

    // overrides applied
    expect(await access.levelFor('alert_rules', 'VIEWER')).toBe('none')
    expect(await access.levelFor('alert_rules', 'EDITOR')).toBe('edit')
    // untouched cells keep the registry default
    expect(await access.levelFor('alert_rules', 'ADMIN')).toBe('edit')
    // superadmin is never lockable
    expect(await access.levelFor('alert_rules', 'SUPERADMIN')).toBe('edit')

    // forUser reflects the stored state per role (what the frontend gates on)
    const managerLevels = await access.forUser('EDITOR')
    expect(managerLevels.alert_rules).toBe('edit')
    expect(managerLevels.resolution_rules).toBeUndefined() // not a governed page anymore
    const coordinatorLevels = await access.forUser('VIEWER')
    expect(coordinatorLevels.alert_rules).toBe('none') // VIEWER override applied
  })
})
