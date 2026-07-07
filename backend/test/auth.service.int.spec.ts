import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { JwtService } from '@nestjs/jwt'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'
import { UsersRepository } from '../src/db/repositories/users.repository'
import { AuthService } from '../src/auth/auth.service'
import { hashPassword } from '../src/auth/password'

let db: TestDB
let auth: AuthService

beforeAll(async () => {
  const t = await getTestDb()
  db = t.db
  auth = new AuthService(new UsersRepository(db), new JwtService({ secret: 'test-secret' }))
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seedUser(role = 'EDITOR') {
  await db.insert(schema.users).values({
    email: 'eddie@cobalt.hk',
    name: 'Eddie',
    passwordHash: await hashPassword('cobalt'),
    role: role as never,
  })
}

describe('AuthService (integration)', () => {
  it('logs in with correct credentials and issues a token carrying the role', async () => {
    await seedUser('EDITOR')
    const res = await auth.login('eddie@cobalt.hk', 'cobalt')
    expect(res).not.toBeNull()
    expect(res!.user.role).toBe('EDITOR')
    expect(typeof res!.token).toBe('string')
  })
  it('rejects a wrong password', async () => {
    await seedUser()
    expect(await auth.login('eddie@cobalt.hk', 'nope')).toBeNull()
  })
  it('rejects an unknown email', async () => {
    expect(await auth.login('ghost@cobalt.hk', 'cobalt')).toBeNull()
  })
})
