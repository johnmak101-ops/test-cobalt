import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '@cobalt/contracts'

/** DI token for the Drizzle database handle. */
export const DRIZZLE = 'DRIZZLE'

/** The typed Drizzle handle, schema-aware over all tracking/queue/evidence tables. */
export type DrizzleDB = NodePgDatabase<typeof schema>

export const drizzleProvider = {
  provide: DRIZZLE,
  useFactory: (): DrizzleDB => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL })
    return drizzle(pool, { schema })
  },
}
