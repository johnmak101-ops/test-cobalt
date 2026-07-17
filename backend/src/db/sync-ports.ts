/**
 * Manual / ops ports master sync (#159):
 *   pnpm --filter backend ports:sync
 *   PORTS_UNLOCODE_URL=… PORTS_OURAIRPORTS_URL=… npx tsx src/db/sync-ports.ts
 *   npx tsx src/db/sync-ports.ts ./code-list.csv ./airports.csv   # local files (legacy load-ports)
 *
 * Same PortsSyncService path as Nest monthly scheduler. Upsert-never-delete.
 */
import { createKysely } from './kysely/mssql-dialect'
import type { DB } from './kysely/db'
import { PortsSyncService } from '../masters/ports-sync.service'

async function main() {
  const [unlocodePath, airportsPath] = process.argv.slice(2)
  const db = createKysely<DB>(
    process.env.SQL_SERVER_URL ??
      'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true',
  )
  const svc = new PortsSyncService(db)
  const summary = await svc.sync({
    unlocodePath: unlocodePath || undefined,
    airportsPath: airportsPath || undefined,
  })
  console.log(
    `ports: fetched=${summary.fetched} inserted=${summary.inserted} updated=${summary.updated} withIata=${summary.withIata}${summary.error ? ` ERROR=${summary.error}` : ''}`,
  )
  await db.destroy()
  if (summary.error) process.exit(1)
}

main().catch((e) => {
  console.error('sync-ports FATAL', e instanceof Error ? e.message : e)
  process.exit(1)
})
