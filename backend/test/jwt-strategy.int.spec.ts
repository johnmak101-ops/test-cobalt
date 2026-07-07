import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { ConfigService } from '@nestjs/config'
import * as schema from '../src/db/contracts'
import { getTestDb, resetDb, closeTestDb, type TestDB } from './setup-db'
import { UsersRepository } from '../src/db/repositories/users.repository'
import { JwtStrategy } from '../src/auth/jwt.strategy'
import { hashPassword } from '../src/auth/password'

let db: TestDB
let strategy: JwtStrategy

beforeAll(async () => {
  db = (await getTestDb()).db
  const config = { getOrThrow: () => 'test-secret' } as unknown as ConfigService
  strategy = new JwtStrategy(new UsersRepository(db), config)
})
afterAll(closeTestDb)
beforeEach(() => resetDb(db))

async function seed(mustReset: boolean) {
  const [u] = await db
    .insert(schema.users)
    .values({
      email: 'x@cobalt.hk',
      name: 'X',
      passwordHash: await hashPassword('p'),
      role: 'ADMIN' as never,
      mustReset,
    })
    .returning()
  return u
}

describe('JwtStrategy.validate — attaches mustReset to req.user (so /auth/me survives reload)', () => {
  it('includes mustReset=true for a must-reset user', async () => {
    const u = await seed(true)
    const reqUser = await strategy.validate({ sub: u.id })
    expect(reqUser.mustReset).toBe(true)
  })
  it('includes mustReset=false for a normal user', async () => {
    const u = await seed(false)
    const reqUser = await strategy.validate({ sub: u.id })
    expect(reqUser.mustReset).toBe(false)
  })
})
