import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { AlertsService } from './alerts.service'
import { AlertEvaluatorService } from './alert-evaluator.service'

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
  @Post('evaluate') evaluate() {
    return this.evaluator.evaluate()
  }
  @Post(':id/dismiss') dismiss(@Param('id') id: string) {
    return this.alerts.dismiss(id)
  }
  @Post(':id/resolve') resolve(@Param('id') id: string) {
    return this.alerts.resolve(id)
  }
  @Post(':id/snooze') snooze(@Param('id') id: string, @Body() body: { until: string }) {
    return this.alerts.snooze(id, new Date(body.until))
  }
}
