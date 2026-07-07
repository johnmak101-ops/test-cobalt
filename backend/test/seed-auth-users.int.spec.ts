import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'
import { seedAuthUsers } from '../src/db/seed-auth-users'

let db: TestDB
beforeAll(async () => {
  db = (await getTestDb()).db
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

describe('seedAuthUsers — initial accounts', () => {
  it('seeds exactly 2 human admin accounts (super + admin), both forced to reset on first login', async () => {
    await seedAuthUsers(db)
    const all = await db.select().from(schema.users)
    const humans = all.filter((u) => u.email !== 'agent@cobalt.hk')
    expect(humans.map((u) => u.email).sort()).toEqual(['admin@cobalt.hk', 'super@cobalt.hk'])
    expect(humans.every((u) => u.mustReset)).toBe(true)
    const byEmail = Object.fromEntries(all.map((u) => [u.email, u]))
    expect(byEmail['super@cobalt.hk'].role).toBe('SUPERADMIN')
    expect(byEmail['admin@cobalt.hk'].role).toBe('ADMIN')
  })

  it('seeds the agent service account WITHOUT a forced reset (machine login)', async () => {
    await seedAuthUsers(db)
    const [agent] = await db.select().from(schema.users).where(eq(schema.users.email, 'agent@cobalt.hk'))
    expect(agent).toBeTruthy()
    expect(agent.role).toBe('EDITOR')
    expect(agent.mustReset).toBe(false)
  })

  it('does not seed the old viewer/editor dev accounts', async () => {
    await seedAuthUsers(db)
    const emails = (await db.select().from(schema.users)).map((u) => u.email)
    expect(emails).not.toContain('viewer@cobalt.hk')
    expect(emails).not.toContain('editor@cobalt.hk')
  })

  it('returns the seeded rows so callers can attribute demo data to a real user', async () => {
    const rows = await seedAuthUsers(db)
    expect(rows.find((u) => u.email === 'admin@cobalt.hk')?.id).toBeTruthy()
  })
})
