import { Controller, Get, Inject } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { DRIZZLE, type DrizzleDB } from '../db/drizzle.provider'

@Controller('health')
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Get()
  async health() {
    let dbUp = false
    try {
      const r = await this.db.execute(sql`select 1 as ok`)
      dbUp = (r.rows?.[0] as { ok?: number } | undefined)?.ok === 1
    } catch {
      dbUp = false
    }
    return { status: 'ok', db: dbUp ? 'up' : 'down', ts: new Date().toISOString() }
  }
}
