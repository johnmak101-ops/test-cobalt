import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Kysely/SQL Server port of FieldLockRepository.
 *
 *  🔴 A LOCK IS NOT A WRITE BARRIER. Since PR #232 the committer is latest-email-wins *including over a
 *  lock* (`CommitterService.applyFields`) — it writes the column and leaves this row alone. What the lock
 *  row buys you is the human's value, kept verbatim and indefinitely, so `column !== lockedValue` can be
 *  computed later: that comparison IS the contested-field signal (`ShipmentsService.contestedLocks`), which
 *  the detail page renders as your-value/new-value and the operator resolves with `keepNewLockValue` (relock
 *  to the newer value) or `restoreLockValue` (write the human value back).
 *
 *  So: never delete a lock row to "let the agent through" — the agent is already through, and deleting the
 *  row only destroys the evidence that there was ever a disagreement.
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

  /** Record a human-set value for a field (idempotent on entity+field). This does NOT stop the agent from
   *  overwriting the column — see the class note. It preserves what the human chose so a later divergence
   *  surfaces as contested rather than vanishing. */
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
