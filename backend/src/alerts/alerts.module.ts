import { Module } from '@nestjs/common'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'
import { AlertEvaluatorService } from './alert-evaluator.service'
import { AlertSchedulerService } from './alert-scheduler.service'

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, AlertEvaluatorService, AlertSchedulerService],
  // Export scheduler for intentional lifecycle use; export evaluator so save-rules can re-run now.
  exports: [AlertSchedulerService, AlertEvaluatorService],
})
export class AlertsModule {}
