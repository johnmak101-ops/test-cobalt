import { Migrator, FileMigrationProvider } from 'kysely/migration'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Kysely } from 'kysely'

/**
 * Apply every migration module in `migrationsFolder` (filename order, ascending) that hasn't run yet.
 * Uses Kysely's Migrator + FileMigrationProvider. Migrations are `.ts` modules exporting `{ up, down }`
 * (the provider does NOT read `.sql` files) — the DDL lives in a `sql` template inside `up`, split on
 * `-- statement-breakpoint` lines (NOT `GO` — tedious doesn't understand `GO`).
 *
 * A custom `import` is passed so Windows bare paths (`D:\…`) are converted to `file://` URLs (Node's ESM
 * loader rejects bare Windows paths); on Linux this is a no-op. Returns the applied migration names.
 */
export async function runMigrations(db: Kysely<unknown>, migrationsFolder: string): Promise<string[]> {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs: { readdir: (p) => fs.readdir(p) },
      path: { join },
      migrationFolder: migrationsFolder,
      import: (filePath) => import(pathToFileURL(filePath).href),
    }),
  })
  const { error, results } = await migrator.migrateToLatest()
  if (error) throw error
  const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName)
  return applied
}
