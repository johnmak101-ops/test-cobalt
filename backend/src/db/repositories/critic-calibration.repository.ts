import { Inject, Injectable } from '@nestjs/common'
import { type Kysely, sql } from 'kysely'
import type { DB, CalibrationOutcome } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/** Phase 3 calibration is a slow statistical signal — keep 180 days (vs routing_shadow 30). */
export const CALIBRATION_RETENTION_DAYS = 180
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

@Injectable()
export class CriticCalibrationRepository {
  private lastPruneAt = 0

  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async insert(row: {
    shipmentId: string | null
    band: 'low' | 'medium' | 'high' | null
    outcome: CalibrationOutcome
    correctedFieldCount: number
    actorId: string | null
    reasons: string[] | null
  }) {
    const res = await this.db.insertInto('criticCalibration').values({
      shipmentId: row.shipmentId,
      band: row.band,
      outcome: row.outcome,
      correctedFieldCount: row.correctedFieldCount,
      actorId: row.actorId,
      reasonsJson: row.reasons ? JSON.stringify(row.reasons) : null,
    }).execute()
    this.maybePrune()
    return res
  }

  private maybePrune(): void {
    const now = Date.now()
    if (now - this.lastPruneAt < PRUNE_INTERVAL_MS) return
    this.lastPruneAt = now
    void this.pruneOlderThan(CALIBRATION_RETENTION_DAYS).catch(() => {})
  }

  pruneOlderThan(days = CALIBRATION_RETENTION_DAYS) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    return this.db.deleteFrom('criticCalibration').where('decidedAt', '<', cutoff).execute()
  }

  listSince(since: Date, limit = 2000) {
    const capped = Math.max(1, Math.floor(limit))
    return this.db.selectFrom('criticCalibration')
      .where('decidedAt', '>=', since)
      .orderBy('decidedAt', 'desc')
      .modifyFront(sql`top ${sql.lit(capped)}`)
      .selectAll()
      .execute()
  }
}
