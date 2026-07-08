import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  // Custom Postgres schemas are EXCLUDED by drizzle-kit unless listed here.
  // (Learned on cobalt-queue: without this, custom-schema tables are silently skipped.)
  schemaFilter: ['public', 'tracking', 'audit', 'alerts', 'ingest'],
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
})
