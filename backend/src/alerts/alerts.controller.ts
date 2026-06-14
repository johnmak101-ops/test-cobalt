import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { AlertsService } from './alerts.service'
import { AlertEvaluatorService } from './alert-evaluator.service'
import { Roles } from '../auth/decorators'

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly evaluator: AlertEvaluatorService,
  ) {}

  @Get() list(@Query('status') status?: string) {
    return this.alerts.list(status)
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
}
