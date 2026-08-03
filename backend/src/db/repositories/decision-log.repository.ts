import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/**
 * decision_log (0032) — append-only record of every ReconGroup the committer applied, in arrival order.
 *
 * This is the REBUILD source: ReconcileService replays these rows through the committer instead of
 * re-deriving shipments from raw evidence, so a rebuild reproduces the agent path by construction
 * (no second grouper/merge to drift — candrholdings#51). The write sits ON the decision path and is
 * deliberately not fire-and-forget: a decision that applied but never logged would silently vanish
 * from every future rebuild, which is worse than failing the POST and letting the queue retry.
 * Replaying a duplicate (from such a retry) is harmless — the committer is idempotent.
 */
@Injectable()
export class DecisionLogRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  async append(group: Record<string, unknown>): Promise<void> {
    await this.db.insertInto('decisionLog').values({ payload: JSON.stringify(group) }).execute()
  }

  /** Every logged decision, id ASC — insertion order IS arrival order (the queue posts serially). */
  allInOrder() {
    return this.db.selectFrom('decisionLog').orderBy('id', 'asc').selectAll().execute()
  }
}
