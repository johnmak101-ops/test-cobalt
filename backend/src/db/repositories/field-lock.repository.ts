import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for human-wins field locks. */
@Injectable()
export class FieldLockRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  forEntity(entityId: string) {
    return this.db.select().from(schema.fieldLocks).where(eq(schema.fieldLocks.entityId, entityId))
  }

  /** Lock a field to a human-set value (idempotent on entity+field). The agent may never overwrite it. */
  lock(entityType: 'booking' | 'shipment', entityId: string, field: string, value: string | null, userId: string | null) {
    return this.db
      .insert(schema.fieldLocks)
      .values({ entityType, entityId, field, lockedValue: value, lockedBy: userId })
      .onConflictDoUpdate({
        target: [schema.fieldLocks.entityType, schema.fieldLocks.entityId, schema.fieldLocks.field],
        set: { lockedValue: value, lockedBy: userId, lockedAt: new Date() },
      })
  }
}
