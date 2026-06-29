import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { AlertsService } from './alerts.service'
import { AlertEvaluatorService } from './alert-evaluator.service'
import { PresentationService } from '../presentation/presentation.service'
import { Roles } from '../auth/decorators'

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly evaluator: AlertEvaluatorService,
    private readonly ui: PresentationService,
  ) {}

  /** UI alert list: wrapped `{ alerts }` with the nested shipment summary the UI renders. */
  @Get() list(@Query('status') status?: string) {
    return this.ui.alerts(status)
  }
  @Get('rules') rules() {
    return this.alerts.rules()
  }

  @Roles('EDITOR', 'ADMIN')
  @Post('evaluate') evaluate() {
    return this.evaluator.evaluate()
  }
  @Roles('EDITOR', 'ADMIN')
  @Post(':id/dismiss') dismiss(@Param('id') id: string) {
    return this.alerts.dismiss(id)
  }
  @Roles('EDITOR', 'ADMIN')
  @Post(':id/resolve') resolve(@Param('id') id: string) {
    return this.alerts.resolve(id)
  }
  @Roles('EDITOR', 'ADMIN')
  @Post(':id/snooze') snooze(@Param('id') id: string, @Body() body: { until: string }) {
    return this.alerts.snooze(id, new Date(body.until))
  }

  // PATCH variants the new UI calls (idempotent state changes on a single alert).
  @Roles('EDITOR', 'ADMIN')
  @Patch(':id/dismiss') patchDismiss(@Param('id') id: string) {
    return this.alerts.dismiss(id)
  }
  @Roles('EDITOR', 'ADMIN')
  @Patch(':id/snooze') patchSnooze(@Param('id') id: string, @Body() body: { hours?: number }) {
    return this.alerts.snoozeForHours(id, body?.hours ?? 24)
  }
  @Roles('EDITOR', 'ADMIN')
  @Patch(':id/read') patchRead(@Param('id') id: string) {
    return this.alerts.markRead(id)
  }
  @Roles('EDITOR', 'ADMIN')
  @Patch(':id/unread') patchUnread(@Param('id') id: string) {
    return this.alerts.markUnread(id)
  }
}
