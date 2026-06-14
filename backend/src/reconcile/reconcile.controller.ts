import { Controller, Post } from '@nestjs/common'
import { ReconcileService } from './reconcile.service'
import { Roles } from '../auth/decorators'

@Controller('reconcile')
export class ReconcileController {
  constructor(private readonly reconcile: ReconcileService) {}

  /** Run reconciliation over all current evidence (idempotent). Editors+ only. */
  @Roles('EDITOR', 'ADMIN')
  @Post('run')
  run() {
    return this.reconcile.run()
  }
}
