import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db.generated'

/** Kysely/SQL Server port of SettingsRepository. Key/value app settings (the [key] column is escaped). */
export class KyselySettingsRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const row = await this.db.selectFrom('appSettings').where(sql`[key]`, '=', key).select('value').executeTakeFirst()
    if (!row) return null
    // value is NVARCHAR(MAX) holding JSON (jsonb in Postgres). ParseJSONResultsPlugin only parses
    // objects/arrays, so bare scalars (numbers/strings) need an explicit parse to round-trip like jsonb.
    try { return JSON.parse(row.value) as T } catch { return row.value as unknown as T }
  }

  async set(key: string, value: unknown, updatedBy: string | null = null) {
    const json = JSON.stringify(value)
    // MERGE-style upsert: update if exists, else insert
    const existing = await this.db.selectFrom('appSettings').where(sql`[key]`, '=', key).select(sql`[key]`.as('k')).executeTakeFirst()
    if (existing) {
      await this.db.updateTable('appSettings').set({ value: json, updatedBy, updatedAt: new Date() }).where(sql`[key]`, '=', key).execute()
    } else {
      await this.db.insertInto('appSettings').values({ key, value: json, updatedBy, updatedAt: new Date() }).execute()
    }
  }
}
