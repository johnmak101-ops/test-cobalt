import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { getTestDb, resetDb, closeTestDb, repos, type TestDB } from './setup-db'
import { UsersService } from '../src/users/users.service'
import { verifyPassword } from '../src/auth/password'

let db: TestDB
let users: UsersService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  users = new UsersService(repos(db).users)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

const mk = (over: Partial<{ email: string; name: string; role: string; password: string }> = {}) =>
  users.create({ email: 'x@cobalt.hk', name: 'X Person', role: 'VIEWER', password: 'secret1', ...over })

describe('UsersService (integration)', () => {
  it('creates a user, hashes the password, and never returns the hash', async () => {
    const u = await mk({ email: 'New@Cobalt.HK', name: 'New Person', role: 'EDITOR' })
    expect(u.email).toBe('new@cobalt.hk')
    expect(u.role).toBe('EDITOR')
    expect(u.avatarInitials).toBe('NP')
    expect((u as Record<string, unknown>).passwordHash).toBeUndefined()
  })

  it('rejects a duplicate email', async () => {
    await mk({ email: 'dup@cobalt.hk' })
    await expect(mk({ email: 'dup@cobalt.hk' })).rejects.toThrow()
  })

  it('lists users without password hashes', async () => {
    await mk({ email: 'a@cobalt.hk' })
    const list = await users.list()
    expect(list).toHaveLength(1)
    expect((list[0] as Record<string, unknown>).passwordHash).toBeUndefined()
  })

  it('a superadmin updates the role and re-hashes a new password', async () => {
    const u = await mk({ email: 'c@cobalt.hk' })
    const updated = await users.update(u.id, { role: 'ADMIN', password: 'newpass1' }, 'SUPERADMIN')
    expect(updated.role).toBe('ADMIN')
    const row = (await repos(db).users.list()).find((r) => r.id === u.id)!
    expect(await verifyPassword('newpass1', row.passwordHash)).toBe(true)
  })

  it('an ADMIN can update a normal user', async () => {
    const u = await mk({ email: 'd@cobalt.hk' })
    const updated = await users.update(u.id, { role: 'EDITOR' }, 'ADMIN')
    expect(updated.role).toBe('EDITOR')
  })

  it('an ADMIN CANNOT grant the SUPERADMIN role', async () => {
    const u = await mk({ email: 'e@cobalt.hk' })
    await expect(users.update(u.id, { role: 'SUPERADMIN' }, 'ADMIN')).rejects.toThrow()
  })

  it('an ADMIN CANNOT modify a SUPERADMIN', async () => {
    const s = await mk({ email: 's@cobalt.hk', role: 'SUPERADMIN' })
    await expect(users.update(s.id, { active: false }, 'ADMIN')).rejects.toThrow()
  })

  it('a SUPERADMIN can grant SUPERADMIN', async () => {
    const u = await mk({ email: 'p@cobalt.hk' })
    const updated = await users.update(u.id, { role: 'SUPERADMIN' }, 'SUPERADMIN')
    expect(updated.role).toBe('SUPERADMIN')
  })

  it('remove soft-deactivates (self blocked); the row persists as inactive', async () => {
    const u = await mk({ email: 'g@cobalt.hk' })
    await expect(users.remove(u.id, u.id)).rejects.toThrow() // self blocked
    const out = await users.remove(u.id, 'some-other-id')
    expect(out.active).toBe(false)
    const list = await users.list()
    expect(list).toHaveLength(1) // NOT hard-deleted
    expect(list[0].active).toBe(false)
  })

  it('create forces a first-login reset (mustReset=true), exposed by safe()', async () => {
    const u = await mk({ email: 'nb@cobalt.hk' })
    expect(u.mustReset).toBe(true)
  })

  it('an admin-set password re-flags mustReset', async () => {
    const u = await mk({ email: 'ap@cobalt.hk' })
    await repos(db).users.update(u.id, { mustReset: false }) // simulate the user having already reset
    const updated = await users.update(u.id, { password: 'newpass12' }, 'SUPERADMIN')
    expect(updated.mustReset).toBe(true)
  })

  it('refuses to deactivate the last active superadmin, allows it once a second exists', async () => {
    const boss = await mk({ email: 'boss@cobalt.hk', role: 'SUPERADMIN' })
    await expect(users.remove(boss.id, 'other-id')).rejects.toThrow(/last active superadmin/i)
    await mk({ email: 'boss2@cobalt.hk', role: 'SUPERADMIN' }) // now 2 active superadmins
    const out = await users.remove(boss.id, 'other-id')
    expect(out.active).toBe(false)
  })

  it('refuses to demote the last active superadmin via update', async () => {
    const boss = await mk({ email: 'solo@cobalt.hk', role: 'SUPERADMIN' })
    await expect(users.update(boss.id, { role: 'ADMIN' }, 'SUPERADMIN')).rejects.toThrow(/last active superadmin/i)
  })

  it('a superadmin cannot deactivate or demote their OWN account via update', async () => {
    const me = await mk({ email: 'me@cobalt.hk', role: 'SUPERADMIN' })
    await mk({ email: 'other-super@cobalt.hk', role: 'SUPERADMIN' }) // ensure it's the self-guard, not the last-super guard, that blocks
    await expect(users.update(me.id, { active: false }, 'SUPERADMIN', me.id)).rejects.toThrow(/your own account/i)
    await expect(users.update(me.id, { role: 'ADMIN' }, 'SUPERADMIN', me.id)).rejects.toThrow(/your own account/i)
  })
})
