import type { Kysely } from 'kysely'
import { createKysely } from './kysely/mssql-dialect'
import type { DB } from './kysely/db'

/** DI token for the Kysely database handle (SQL Server / Fabric SQL). */
export const KYSELY = 'KYSELY'

/** The typed Kysely handle over the full 29-table schema. */
export type KyselyDB = Kysely<DB>

/**
 * Connection string shape (ADO.NET style, parsed by `parseMssqlConnectionString`):
 * `Server=host,port;Database=db;User Id=sa;Password=...;Encrypt=false;TrustServerCertificate=true`
 * Read bare off process.env (like DATABASE_URL was) — env.validation passes unknown keys through.
 */
export const kyselyProvider = {
  provide: KYSELY,
  useFactory: (): KyselyDB => createKysely<DB>(process.env.SQL_SERVER_URL ?? ''),
}
