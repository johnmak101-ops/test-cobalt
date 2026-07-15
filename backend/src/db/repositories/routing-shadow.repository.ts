import { Inject, Injectable } from '@nestjs/common'
import { type Kysely, sql } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

export type RoutingStatus = 'confirmed' | 'provisional' | 'skip'

@Injectable()
export class RoutingShadowRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  insert(row: {
    shipmentId: string | null
    gateRouting: RoutingStatus
    bandRouting: RoutingStatus
    band: 'low' | 'medium' | 'high' | null
    differs: boolean
    reasons: string[] | null
  }) {
    return this.db.insertInto('routingShadow').values({
      shipmentId: row.shipmentId,
      gateRouting: row.gateRouting,
      bandRouting: row.bandRouting,
      band: row.band,
      differs: row.differs,
      reasonsJson: row.reasons ? JSON.stringify(row.reasons) : null,
    }).execute()
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
