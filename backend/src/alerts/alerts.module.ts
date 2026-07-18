import { Module } from '@nestjs/common'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'
import { AlertEvaluatorService } from './alert-evaluator.service'
import { AlertSchedulerService } from './alert-scheduler.service'

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluatorService, AlertSchedulerService],
  // Export so nestjs-doctor sees lifecycle-only scheduler as intentional (OnModuleInit timers).
  exports: [AlertSchedulerService],
})
export class AlertsModule {}
