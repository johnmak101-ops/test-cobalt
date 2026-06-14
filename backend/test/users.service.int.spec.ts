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

  it('deletes a user, but not yourself', async () => {
    const u = await mk({ email: 'g@cobalt.hk' })
    await expect(users.remove(u.id, u.id)).rejects.toThrow() // self-delete blocked
    expect(await users.remove(u.id, 'some-other-id')).toEqual({ deleted: true })
    expect(await users.list()).toHaveLength(0)
  })
})
