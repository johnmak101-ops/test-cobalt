import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { JwtService } from '@nestjs/jwt'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'
import { UsersRepository } from '../src/db/repositories/users.repository'
import { AuthService } from '../src/auth/auth.service'
import { hashPassword } from '../src/auth/password'

let db: TestDB
let users: UsersRepository
let auth: AuthService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  users = new UsersRepository(db)
  auth = new AuthService(users, new JwtService({ secret: 'test-secret' }))
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seed(mustReset: boolean) {
  return db
    .insertInto('users')
    .values({
      email: 'newbie@cobalt.hk',
      name: 'Newbie',
      passwordHash: await hashPassword('temp-pass'),
      role: 'ADMIN',
      mustReset,
    })
    .outputAll('inserted')
    .executeTakeFirstOrThrow()
}

describe('AuthService — forced first-login password reset (mustReset)', () => {
  it('login surfaces mustReset=true for a must-reset user', async () => {
    await seed(true)
    const res = await auth.login('newbie@cobalt.hk', 'temp-pass')
    expect(res).not.toBeNull()
    expect(res!.user.mustReset).toBe(true)
  })

  it('login surfaces mustReset=false for a normal user', async () => {
    await seed(false)
    const res = await auth.login('newbie@cobalt.hk', 'temp-pass')
    expect(res!.user.mustReset).toBe(false)
  })

  it('changePassword with the correct current password sets a new password and clears mustReset', async () => {
    const u = await seed(true)
    await auth.changePassword(u.id, 'temp-pass', 'brand-new-pass')
    // old password no longer works; the new one does, and mustReset is cleared
    expect(await auth.login('newbie@cobalt.hk', 'temp-pass')).toBeNull()
    const res = await auth.login('newbie@cobalt.hk', 'brand-new-pass')
    expect(res).not.toBeNull()
    expect(res!.user.mustReset).toBe(false)
  })

  it('changePassword with a wrong current password fails and leaves the account unchanged', async () => {
    const u = await seed(true)
    await expect(auth.changePassword(u.id, 'WRONG-pass', 'brand-new-pass')).rejects.toThrow()
    // still the old password, still must-reset
    const res = await auth.login('newbie@cobalt.hk', 'temp-pass')
    expect(res).not.toBeNull()
    expect(res!.user.mustReset).toBe(true)
  })
})
