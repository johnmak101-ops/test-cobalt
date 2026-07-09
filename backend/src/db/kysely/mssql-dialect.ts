import { Kysely, MssqlDialect, ParseJSONResultsPlugin, CamelCasePlugin } from 'kysely'
import * as Tarn from 'tarn'
import * as Tedious from 'tedious'

/**
 * Build a Kysely instance over SQL Server / Fabric SQL (MSSQL dialect via tedious + tarn pool).
 * - `ParseJSONResultsPlugin` parses NVARCHAR(MAX) json columns back into objects.
 * - `CamelCasePlugin` maps snake_case DB columns ↔ camelCase TS fields (the repo convention).
 * Connection string format: `Server=host,port;Database=db;User Id=sa;Password=...;Encrypt=false;TrustServerCertificate=true`.
 */
export function createKysely<DB>(connectionString: string): Kysely<DB> {
  const cfg = parseMssqlConnectionString(connectionString)
  return new Kysely<DB>({
    dialect: new MssqlDialect({
      tarn: { options: { max: 10, min: 0 }, ...Tarn },
      tedious: {
        ...Tedious,
        connectionFactory: () =>
          new Tedious.Connection({
            authentication: { type: 'default', options: { userName: cfg.user, password: cfg.password } },
            options: { database: cfg.database, port: cfg.port, trustServerCertificate: true, encrypt: false },
            server: cfg.server,
          }),
      },
    }),
    plugins: [new ParseJSONResultsPlugin(), new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  })
}

interface MssqlConnConfig { server: string; port: number; database: string; user: string; password: string }

/** Parse a SQL Server ADO.NET-style connection string into the parts tedious needs. */
export function parseMssqlConnectionString(s: string): MssqlConnConfig {
  const parts = Object.fromEntries(
    s
      .split(';')
      .map((kv) => kv.trim())
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=')
        return [kv.slice(0, i).trim().toLowerCase(), kv.slice(i + 1).trim()]
      }),
  )
  const serverRaw = String(parts['server'] ?? '')
  const [server, portStr] = serverRaw.split(',')
  const port = portStr ? Number(portStr) : 1433
  return {
    server: server ?? 'localhost',
    port,
    database: String(parts['database'] ?? ''),
    user: String(parts['user id'] ?? ''),
    password: String(parts['password'] ?? ''),
  }
}
