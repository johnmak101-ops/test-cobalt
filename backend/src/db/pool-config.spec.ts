import { describe, it, expect } from 'vitest'
import { poolConfig } from './drizzle.provider'

describe('poolConfig (tracking backend)', () => {
  it('maps env onto node-postgres Pool options with read-heavy defaults + statement_timeout', () => {
    const c = poolConfig({ DATABASE_URL: 'postgres://u:p@h:5432/db' } as NodeJS.ProcessEnv)
    expect(c.connectionString).toBe('postgres://u:p@h:5432/db')
    expect(c.max).toBe(15)
    expect(c.statement_timeout).toBe(30_000)
    expect(c.idle_in_transaction_session_timeout).toBe(30_000)
    expect(c.idleTimeoutMillis).toBe(30_000)
  })

  it('honors env overrides', () => {
    const c = poolConfig({ DATABASE_URL: 'x', POOL_MAX: '20', DB_STATEMENT_TIMEOUT_MS: '60000' } as unknown as NodeJS.ProcessEnv)
    expect(c.max).toBe(20)
    expect(c.statement_timeout).toBe(60_000)
  })
})
