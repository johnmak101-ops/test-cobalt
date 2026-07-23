import { Controller, Post, Query } from '@nestjs/common'
import { ReconcileService } from './reconcile.service'
import { StateRefreshService } from './state-refresh.service'
import { Roles } from '../auth/decorators'

@Controller('reconcile')
export class ReconcileController {
  constructor(
    private readonly reconcile: ReconcileService,
    private readonly stateRefresh: StateRefreshService,
  ) {}

  /** Run reconciliation over all current evidence (idempotent). Editors+ only. */
  @Roles('EDITOR', 'ADMIN')
  @Post('run')
  run() {
    return this.reconcile.run()
  }

  /**
   * Re-derive lifecycle state for every live leg — the manual trigger for what the hourly scheduler
   * does. `?dryRun=1` reports the promotions it WOULD make and writes nothing, which is how you look
   * before running it against real data for the first time.
   */
  @Roles('EDITOR', 'ADMIN')
  @Post('refresh-state')
  refreshState(@Query('dryRun') dryRun?: string) {
    return this.stateRefresh.refresh(new Date(), { dryRun: dryRun === '1' || dryRun === 'true' })
  }
}
