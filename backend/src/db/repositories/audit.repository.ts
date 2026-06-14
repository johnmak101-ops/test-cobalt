import { Inject, Injectable } from '@nestjs/common'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

/** Append-only audit log writer. */
@Injectable()
export class AuditRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  write(row: typeof schema.changeLog.$inferInsert) {
    return this.db.insert(schema.changeLog).values(row)
  }
}
