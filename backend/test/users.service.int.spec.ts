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

describe('UsersService (integration)', () => {
  it('creates a user, hashes the password, and never returns the hash', async () => {
    const u = await users.create({ email: 'New@Cobalt.HK', name: 'New Person', role: 'EDITOR', password: 'secret1' })
    expect(u.email).toBe('new@cobalt.hk') // lowercased
    expect(u.role).toBe('EDITOR')
    expect(u.avatarInitials).toBe('NP')
    expect((u as Record<string, unknown>).passwordHash).toBeUndefined()
  })

  it('rejects a duplicate email', async () => {
    await users.create({ email: 'dup@cobalt.hk', name: 'A', role: 'VIEWER', password: 'secret1' })
    await expect(users.create({ email: 'dup@cobalt.hk', name: 'B', role: 'VIEWER', password: 'secret1' })).rejects.toThrow()
  })

  it('lists users without password hashes', async () => {
    await users.create({ email: 'a@cobalt.hk', name: 'A', role: 'VIEWER', password: 'secret1' })
    const list = await users.list()
    expect(list).toHaveLength(1)
    expect((list[0] as Record<string, unknown>).passwordHash).toBeUndefined()
  })

  it('updates the role and re-hashes a new password', async () => {
    const u = await users.create({ email: 'c@cobalt.hk', name: 'C', role: 'VIEWER', password: 'secret1' })
    const updated = await users.update(u.id, { role: 'ADMIN', password: 'newpass1' })
    expect(updated.role).toBe('ADMIN')
    const [row] = await repos(db).users.list().then((rows) => rows.filter((r) => r.id === u.id))
    expect(await verifyPassword('newpass1', row.passwordHash)).toBe(true)
  })

  it('deletes a user', async () => {
    const u = await users.create({ email: 'd@cobalt.hk', name: 'D', role: 'VIEWER', password: 'secret1' })
    expect(await users.remove(u.id)).toEqual({ deleted: true })
    expect(await users.list()).toHaveLength(0)
  })
})
