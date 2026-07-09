import { Controller, Get, Inject } from '@nestjs/common'
import { sql } from 'kysely'
import { KYSELY, type KyselyDB } from '../db/kysely.provider'
import { Public } from '../auth/decorators'

@Controller('health')
export class HealthController {
  constructor(@Inject(KYSELY) private readonly db: KyselyDB) {}

  @Public()
  @Get()
  async health() {
    let dbUp = false
    try {
      const r = await sql<{ ok: number }>`select 1 as ok`.execute(this.db)
      dbUp = r.rows[0]?.ok === 1
    } catch {
      dbUp = false
    }
    return { status: 'ok', db: dbUp ? 'up' : 'down', ts: new Date().toISOString() }
  }
}
