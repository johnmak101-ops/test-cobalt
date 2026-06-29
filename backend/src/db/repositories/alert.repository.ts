import { Inject, Injectable } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for alert rules + fired alerts. */
@Injectable()
export class AlertRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  enabledRules() {
    return this.db.select().from(schema.alertRules).where(eq(schema.alertRules.enabled, true))
  }
  allRules() {
    return this.db.select().from(schema.alertRules).orderBy(schema.alertRules.id)
  }
  list(status?: string) {
    const where = status ? eq(schema.alertInstances.status, status as never) : undefined
    return this.db.select().from(schema.alertInstances).where(where).orderBy(desc(schema.alertInstances.firedAt))
  }
  /** Insert a fired alert; returns true only if it was new (dedup_key unique). */
  async insertDeduped(values: typeof schema.alertInstances.$inferInsert): Promise<boolean> {
    const inserted = await this.db.insert(schema.alertInstances).values(values).onConflictDoNothing().returning()
    return inserted.length > 0
  }
  async setStatus(id: string, status: string, extra: Record<string, unknown>) {
    const [row] = await this.db
      .update(schema.alertInstances)
      .set({ status: status as never, ...extra })
      .where(eq(schema.alertInstances.id, id))
      .returning()
    return row ?? null
  }
  /** Stamp/clear read_at without touching status (an ACTIVE alert can still be read). */
  async setReadAt(id: string, readAt: Date | null) {
    const [row] = await this.db
      .update(schema.alertInstances)
      .set({ readAt })
      .where(eq(schema.alertInstances.id, id))
      .returning()
    return row ?? null
  }
  /** Patch an alert rule (threshold/severity/enabled/country overrides). */
  async updateRule(id: string, patch: Record<string, unknown>) {
    const [row] = await this.db
      .update(schema.alertRules)
      .set(patch)
      .where(eq(schema.alertRules.id, id))
      .returning()
    return row ?? null
  }
}
