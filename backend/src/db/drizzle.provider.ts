import { Pool, type PoolConfig } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@cobalt/contracts'

/** DI token for the Drizzle database handle. */
export const DRIZZLE = 'DRIZZLE'

/** The typed Drizzle handle, schema-aware over all tracking/queue/evidence tables. */
export type DrizzleDB = NodePgDatabase<typeof schema>

const num = (v: string | undefined, dflt: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : dflt
}

/**
 * node-postgres Pool options for the tracking backend — PURE (env in → options out) so the sizing/timeout
 * knobs are unit-testable without a socket. This backend shares ONE Postgres with the write-heavy queue, so
 * it bounds its pool (`max`) to keep the summed connections under `max_connections`, and — critically for a
 * read-heavy app whose list endpoints fan out into many sequential queries — caps every statement with
 * `statement_timeout` so one slow scan can't pin a pool connection, and reaps an abandoned transaction with
 * `idle_in_transaction_session_timeout`.
 */
export function poolConfig(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: num(env.POOL_MAX, 15),
    idleTimeoutMillis: num(env.DB_POOL_IDLE_TIMEOUT_MS, 30_000),
    statement_timeout: num(env.DB_STATEMENT_TIMEOUT_MS, 30_000),
    idle_in_transaction_session_timeout: num(env.DB_IDLE_IN_TXN_TIMEOUT_MS, 30_000),
  }
}

export const drizzleProvider = {
  provide: DRIZZLE,
  useFactory: (): DrizzleDB => {
    const pool = new Pool(poolConfig())
    return drizzle(pool, { schema })
  },
}
