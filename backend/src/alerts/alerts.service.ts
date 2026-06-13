import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { desc, eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../db/drizzle.provider'

@Injectable()
export class AlertsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  list(status?: string) {
    const where = status ? eq(schema.alertInstances.status, status as never) : undefined
    return this.db.select().from(schema.alertInstances).where(where).orderBy(desc(schema.alertInstances.firedAt))
  }

  rules() {
    return this.db.select().from(schema.alertRules).orderBy(schema.alertRules.id)
  }

  dismiss(id: string) {
    return this.setStatus(id, 'DISMISSED', { dismissedAt: new Date() })
  }
  resolve(id: string) {
    return this.setStatus(id, 'RESOLVED', { resolvedAt: new Date() })
  }
  snooze(id: string, until: Date) {
    return this.setStatus(id, 'SNOOZED', { snoozedUntil: until })
  }

  private async setStatus(id: string, status: string, extra: Record<string, unknown>) {
    const [row] = await this.db
      .update(schema.alertInstances)
      .set({ status: status as never, ...extra })
      .where(eq(schema.alertInstances.id, id))
      .returning()
    if (!row) throw new NotFoundException(`alert ${id} not found`)
    return row
  }
}
