import { Inject, Injectable } from '@nestjs/common'
import { type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

type AuditInsert = {
  entityType: string
  entityId: string
  changeType: string
  sourceType: string
  field?: string | null
  oldValue?: string | null
  newValue?: string | null
  sourceId?: string | null
  actorUserId?: string | null
  isDelay?: boolean
  note?: string | null
}

/** Kysely/SQL Server port of AuditRepository (append-only; per-entity reader newest-first, excludes shadow). */
@Injectable()
export class AuditRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  write(row: AuditInsert) {
    return this.db.insertInto('changeLog').values(row).execute()
  }

  async listForEntity(entityType: string, entityId: string) {
    return this.db.selectFrom('changeLog')
      .where('entityType', '=', entityType)
      .where('entityId', '=', entityId)
      .where('changeType', '!=', 'shadow')
      .orderBy('seq desc')
      .selectAll()
      .execute()
  }
}
