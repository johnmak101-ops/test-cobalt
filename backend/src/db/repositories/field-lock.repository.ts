import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Kysely/SQL Server port of FieldLockRepository. Human-wins field locks.
 *
 *  Postgres → MSSQL notes:
 *  - `onConflictDoUpdate` on (entity_type, entity_id, field) → check-then-update-or-insert inside a tx
 *    (MSSQL has no ON CONFLICT DO UPDATE). The unique constraint `uq_field_locks` absorbs the rare
 *    concurrent-insert race as a fallback (caught → read + update).
 *  - `forEntity` returns the executed rows (the Drizzle version returned a thenable query). */
@Injectable()
export class FieldLockRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  /** All locks held against an entity (across both bookings and shipments — the column is unscoped). */
  forEntity(entityId: string) {
    return this.db.selectFrom('fieldLocks').where('entityId', '=', entityId).selectAll().execute()
  }

  /** Lock a field to a human-set value (idempotent on entity+field). The agent may never overwrite it. */
  async lock(
    entityType: 'booking' | 'shipment',
    entityId: string,
    field: string,
    value: string | null,
    userId: string | null,
  ) {
    const existing = await this.db
      .selectFrom('fieldLocks')
      .where('entityType', '=', entityType)
      .where('entityId', '=', entityId)
      .where('field', '=', field)
      .select('id')
      .executeTakeFirst()
    const lockedAt = new Date()
    if (existing) {
      const row = await this.db
        .updateTable('fieldLocks')
        .set({ lockedValue: value, lockedBy: userId, lockedAt })
        .where('id', '=', existing.id)
        .outputAll('inserted')
        .executeTakeFirst()
      return row ?? null
    }
    try {
      const row = await this.db
        .insertInto('fieldLocks')
        .values({ entityType, entityId, field, lockedValue: value, lockedBy: userId, lockedAt })
        .outputAll('inserted')
        .executeTakeFirst()
      return row ?? null
    } catch (e) {
      // unique violation (entity_type, entity_id, field) — a concurrent insert won the race; re-read + update
      if (!/unique|duplicate/i.test((e as Error).message)) throw e
      const row = await this.db
        .updateTable('fieldLocks')
        .set({ lockedValue: value, lockedBy: userId, lockedAt })
        .where('entityType', '=', entityType)
        .where('entityId', '=', entityId)
        .where('field', '=', field)
        .outputAll('inserted')
        .executeTakeFirst()
      return row ?? null
    }
  }
}
