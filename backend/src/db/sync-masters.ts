/**
 * Daily masters sync: pull customers/vendors/forwarders from the Cobalt Mesh ERP and upsert the local
 * read-only mirror (never deletes). Run by a daily cron on the app VM:
 *   0 3 * * *  cd <app> && node dist/db/sync-masters.js
 * Dev:  MESH_*=… SQL_SERVER_URL=… npx tsx src/db/sync-masters.ts
 */
import { createKysely } from './kysely/mssql-dialect'
import type { DB } from './kysely/db'
import { MastersRepository } from './repositories/masters.repository'
import { MeshClient } from '../masters/mesh/mesh.client'
import { MastersSyncService } from '../masters/mesh/masters-sync.service'
import { meshConfigFromEnv } from '../masters/mesh/mesh.config'

async function main() {
  const cfg = meshConfigFromEnv(process.env) // throws (fail-fast) if a required MESH_* var is missing
  const db = createKysely<DB>(
    process.env.SQL_SERVER_URL ??
      'Server=localhost,1433;Database=cobalt;User Id=sa;Password=YourStrong!Passw0rd;Encrypt=false;TrustServerCertificate=true',
  )
  const svc = new MastersSyncService(new MeshClient(cfg), new MastersRepository(db))
  const summary = await svc.sync()
  for (const s of summary) console.log(`${s.type}: fetched=${s.fetched} inserted=${s.inserted} updated=${s.updated}${s.error ? `  ERROR=${s.error}` : ''}`)
  await db.destroy()
  if (summary.some((s) => s.error)) process.exit(1)
}
main().catch((e) => {
  console.error('sync-masters FATAL', e instanceof Error ? e.message : e)
  process.exit(1)
})
