import { Controller, Post } from '@nestjs/common'
import { ReconcileService } from './reconcile.service'

@Controller('reconcile')
export class ReconcileController {
  constructor(private readonly reconcile: ReconcileService) {}

  /** Run reconciliation over all current evidence (idempotent). */
  @Post('run')
  run() {
    return this.reconcile.run()
  }
}
