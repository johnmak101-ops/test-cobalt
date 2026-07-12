import { Module } from '@nestjs/common'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'
import { AlertEvaluatorService } from './alert-evaluator.service'
import { AlertSchedulerService } from './alert-scheduler.service'

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluatorService, AlertSchedulerService],
})
export class AlertsModule {}
