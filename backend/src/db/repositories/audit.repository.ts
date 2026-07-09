import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, ne } from 'drizzle-orm'
import * as schema from '../contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

type AuditEntity = (typeof schema.changeLog.$inferSelect)['entityType']

/** Append-only audit log: writer + per-entity reader (newest first) for the change-history view. */
@Injectable()
export class AuditRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  write(row: typeof schema.changeLog.$inferInsert) {
    return this.db.insert(schema.changeLog).values(row)
  }

  /** Change-log rows for one entity, newest first (by monotonic seq). Excludes de-correction 'shadow'
   *  measurement rows — they record what code WOULD have corrected, not a real change, so they never
   *  belong in the user-facing change-history / email timeline. */
  listForEntity(entityType: AuditEntity, entityId: string) {
    return this.db
      .select()
      .from(schema.changeLog)
      .where(
        and(
          eq(schema.changeLog.entityType, entityType),
          eq(schema.changeLog.entityId, entityId),
          ne(schema.changeLog.changeType, 'shadow'),
        ),
      )
      .orderBy(desc(schema.changeLog.seq))
  }
}
