import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // Custom Postgres schemas are EXCLUDED by drizzle-kit unless listed here.
  // (Learned on cobalt-queue: without this, `queue`/`evidence` tables are silently skipped.)
  schemaFilter: ['public', 'queue', 'evidence', 'tracking', 'audit', 'alerts'],
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
})
