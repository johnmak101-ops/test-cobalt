import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Key/value app settings (tracking-side tunables, e.g. the review-gate confidence threshold). */
@Injectable()
export class SettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const [row] = await this.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key))
    return row ? (row.value as T) : null
  }

  async set(key: string, value: unknown, updatedBy: string | null = null) {
    await this.db
      .insert(schema.appSettings)
      .values({ key, value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy, updatedAt: new Date() } })
  }
}
