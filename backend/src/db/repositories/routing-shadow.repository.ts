import { Inject, Injectable } from '@nestjs/common'
import { type Kysely, sql } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

export type RoutingStatus = 'confirmed' | 'provisional' | 'skip'

/** routing_shadow is an append-only DIAGNOSTIC log backing the Phase 2a flip decision — it must not
 *  grow forever. 30 days is far more than enough to review the gate-vs-band diff, and dropping older
 *  rows is safe: nothing reads them once the window has passed. */
export const SHADOW_RETENTION_DAYS = 30
/** Prune at most this often per process. The delete is indexed on ingested_at and runs fire-and-forget
 *  off the ingest path, so retention never adds latency to (or fails) a decision. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

@Injectable()
export class RoutingShadowRepository {
  private lastPruneAt = 0

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async insert(row: {
    shipmentId: string | null
    gateRouting: RoutingStatus
    bandRouting: RoutingStatus
    band: 'low' | 'medium' | 'high' | null
    differs: boolean
    reasons: string[] | null
  }) {
    const res = await this.db.insertInto('routingShadow').values({
      shipmentId: row.shipmentId,
      gateRouting: row.gateRouting,
      bandRouting: row.bandRouting,
      band: row.band,
      differs: row.differs,
      reasonsJson: row.reasons ? JSON.stringify(row.reasons) : null,
    }).execute()
    this.maybePrune()
    return res
  }

  /** Opportunistic, time-gated retention. Fire-and-forget: never blocks or fails an ingest. */
  private maybePrune(): void {
    const now = Date.now()
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return
    this.lastPruneAt = now
    void this.pruneOlderThan(SHADOW_RETENTION_DAYS).catch(() => {
      // best-effort: a failed prune must never surface on the decision path
    })
  }

  /** Delete shadow rows older than `days`. Safe — the log is diagnostic-only. */
  pruneOlderThan(days = SHADOW_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return this.db.deleteFrom('routingShadow').where('ingestedAt', '<', cutoff).execute()
  }

  listSince(since: Date, limit = 500) {
    const capped = Math.max(1, Math.floor(limit))
    return this.db.selectFrom('routingShadow')
      .where('ingestedAt', '>=', since)
      .orderBy('ingestedAt', 'desc')
      .modifyFront(sql`top ${sql.lit(capped)}`)
      .selectAll()
      .execute()
  }
}
