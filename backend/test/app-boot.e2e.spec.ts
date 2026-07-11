/**
 * Full Nest AppModule HTTP boot under vitest (SWC provides emitDecoratorMetadata).
 * Proves the remaining TODO item: NestFactory + supertest behavioural checks
 * (mustReset → 403, login throttle → 429) that structural guard-wiring alone cannot.
 */
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { getTestDb, type TestDB } from './setup-db'
import { seedAuthUsers } from '../src/db/seed-auth-users'
import { parseMssqlConnectionString } from '../src/db/kysely/mssql-dialect'

const TEST_URL =
  process.env.SQL_SERVER_TEST_URL ??
  'Server=localhost,1433;Database=cobalt_test;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true'

const JWT = 'test-jwt-secret-for-app-boot-e2e-32chars!'

describe('AppModule HTTP boot (NestFactory + SWC metadata)', () => {
  let app: NestExpressApplication
  let db: TestDB

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT
    process.env.SQL_SERVER_URL = TEST_URL
    process.env.COOKIE_SECURE = 'false'
    process.env.NODE_ENV = 'test'
    // Isolate throttle storage per file run
    process.env.THROTTLE_TTL = '60000'

    const t = await getTestDb()
    db = t.db
    // Ensure login accounts exist (idempotent seed)
    await seedAuthUsers(db)

    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: false,
      abortOnError: false,
    })
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
    await app.init()
  }, 90_000)

  afterAll(async () => {
    if (app) await app.close()
  })

  it('boots AppModule and serves public GET /api/health', async () => {
    // Real DI graph + SQL Server (same path as production bootstrap minus listen())
    expect(parseMssqlConnectionString(process.env.SQL_SERVER_URL!).database).toBe('cobalt_test')
    const res = await request(app.getHttpServer()).get('/api/health').expect(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.db).toBe('up')
  })

  it('mustReset user gets 403 MUST_RESET on a gated route after login', async () => {
    // admin@cobalt.hk is seeded with mustReset:true + placeholder password
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@cobalt.hk', password: 'cobalt-change-me' })
    expect([200, 201]).toContain(login.status)
    expect(login.body.user?.mustReset).toBe(true)

    const raw = login.headers['set-cookie']
    const cookie = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []
    expect(cookie.length).toBeGreaterThan(0)

    // /auth/me is AllowDuringMustReset — must still work
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200)

    // masters list is authenticated + not AllowDuringMustReset → MustResetGuard fires
    const blocked = await request(app.getHttpServer()).get('/api/masters/customers').set('Cookie', cookie)
    expect(blocked.status).toBe(403)
    const body = blocked.body as { code?: string; message?: string }
    expect(body.code === 'MUST_RESET' || /password reset/i.test(String(body.message ?? body))).toBe(true)
  })

  it('11th POST /api/auth/login within the window is rate-limited (429)', async () => {
    // @Throttle on login: limit 10 / 60s — use a unique email so we do not depend on prior tests
    const email = `throttle-${Date.now()}@example.com`
    for (let i = 0; i < 10; i++) {
      const r = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'wrong' })
      // 401 invalid credentials still counts toward the throttle
      expect([401, 429]).toContain(r.status)
      if (r.status === 429) {
        // already limited earlier in the suite — accept as pass of the throttle mechanism
        return
      }
    }
    const eleventh = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'wrong' })
    expect(eleventh.status).toBe(429)
  })
})
