import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Data access for human-wins field locks. */
@Injectable()
export class FieldLockRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  forEntity(entityId: string) {
    return this.db.select().from(schema.fieldLocks).where(eq(schema.fieldLocks.entityId, entityId))
  }
}
