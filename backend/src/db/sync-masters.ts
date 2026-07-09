/**
 * Daily masters sync: pull customers/vendors/forwarders from the Cobalt Mesh ERP and upsert the local
 * read-only mirror (never deletes). Run by a daily cron on the app VM:
 *   0 3 * * *  cd <app> && node dist/db/sync-masters.js
 * Dev:  MESH_*=… DATABASE_URL=… npx tsx src/db/sync-masters.ts
 */
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './contracts'
import { MastersRepository } from './repositories/masters.repository'
import { MeshClient } from '../masters/mesh/mesh.client'
import { MastersSyncService } from '../masters/mesh/masters-sync.service'
import { meshConfigFromEnv } from '../masters/mesh/mesh.config'

async function main() {
  const cfg = meshConfigFromEnv(process.env) // throws (fail-fast) if a required MESH_* var is missing
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/cobalt' })
  const svc = new MastersSyncService(new MeshClient(cfg), new MastersRepository(drizzle(pool, { schema })))
  const summary = await svc.sync()
  for (const s of summary) console.log(`${s.type}: fetched=${s.fetched} inserted=${s.inserted} updated=${s.updated}${s.error ? `  ERROR=${s.error}` : ''}`)
  await pool.end()
  if (summary.some((s) => s.error)) process.exit(1)
}
main().catch((e) => {
  console.error('sync-masters FATAL', e instanceof Error ? e.message : e)
  process.exit(1)
})
