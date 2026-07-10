import { Kysely, MssqlDialect, ParseJSONResultsPlugin, CamelCasePlugin } from 'kysely'
import * as Tarn from 'tarn'
import * as Tedious from 'tedious'

/**
 * Build a Kysely instance over SQL Server / Fabric SQL (MSSQL dialect via tedious + tarn pool).
 * - `ParseJSONResultsPlugin` parses NVARCHAR(MAX) json columns back into objects.
 * - `CamelCasePlugin` maps snake_case DB columns ↔ camelCase TS fields (the repo convention).
 *
 * Two auth modes, selected by the connection string (see `parseMssqlConnectionString`):
 * - Local SQL Server (dev/CI container): `Server=host,port;Database=db;User Id=sa;Password=...;Encrypt=false;TrustServerCertificate=true`
 * - Microsoft Fabric SQL (Entra Service Principal): add `Authentication=Active Directory Service Principal`
 *   with `User Id`=clientId, `Password`=clientSecret, `Tenant Id`=tenantId. Encryption is forced on
 *   (Fabric mandates TLS), and `master`/CREATE DATABASE is not available (the DB is pre-provisioned).
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
            authentication: cfg.authentication,
            options: {
              database: cfg.database,
              port: cfg.port,
              trustServerCertificate: cfg.trustServerCertificate,
              encrypt: cfg.encrypt,
            },
            server: cfg.server,
          }),
      },
    }),
    plugins: [new ParseJSONResultsPlugin(), new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  })
}

/** tedious authentication config — either a SQL login or an Entra Service Principal secret. */
type MssqlAuth =
  | { type: 'default'; options: { userName: string; password: string } }
  | {
      type: 'azure-active-directory-service-principal-secret'
      options: { clientId: string; clientSecret: string; tenantId: string }
    }

interface MssqlConnConfig {
  server: string
  port: number
  database: string
  encrypt: boolean
  trustServerCertificate: boolean
  /** true when auth is Entra Service Principal ⇒ Fabric SQL: DB pre-provisioned, `master` not exposed. */
  isEntra: boolean
  authentication: MssqlAuth
}

/** Parse a SQL Server / Fabric ADO.NET-style connection string into the parts tedious needs. */
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
  const [serverName, portStr] = serverRaw.split(',')
  const server = serverName || 'localhost'
  const port = portStr ? Number(portStr) : 1433
  const database = String(parts['database'] ?? '')
  const user = String(parts['user id'] ?? '')
  const password = String(parts['password'] ?? '')
  const trustServerCertificate = parseBool(parts['trustservercertificate'])

  // Entra Service Principal ⇔ the `Authentication` keyword names a service principal (space-insensitive).
  const authKind = String(parts['authentication'] ?? '').toLowerCase().replace(/\s+/g, '')
  if (authKind.includes('serviceprincipal')) {
    const tenantId = String(parts['tenant id'] ?? parts['tenantid'] ?? '')
    if (!tenantId) throw new Error("Fabric/Entra auth requires a 'Tenant Id' in the connection string")
    if (!user || !password)
      throw new Error(
        "Fabric/Entra auth requires 'User Id' (client id) and 'Password' (client secret) in the connection string",
      )
    return {
      server,
      port,
      database,
      encrypt: true, // Fabric SQL mandates TLS — force it on regardless of the string
      trustServerCertificate: trustServerCertificate ?? false,
      isEntra: true,
      authentication: {
        type: 'azure-active-directory-service-principal-secret',
        options: { clientId: user, clientSecret: password, tenantId },
      },
    }
  }

  return {
    server,
    port,
    database,
    encrypt: parseBool(parts['encrypt']) ?? false,
    trustServerCertificate: trustServerCertificate ?? true,
    isEntra: false,
    authentication: { type: 'default', options: { userName: user, password } },
  }
}

/** Parse a connection-string boolean keyword (true/false/1/0/yes/no); undefined if absent or unrecognized. */
function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined
  const s = v.trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  return undefined
}
