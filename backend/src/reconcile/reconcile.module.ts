import { Module } from '@nestjs/common'
import { ReconcileController } from './reconcile.controller'
import { ReconcileService } from './reconcile.service'
import { CommitterService } from './committer.service'
import { StateRefreshService } from './state-refresh.service'
import { StateRefreshSchedulerService } from './state-refresh-scheduler.service'
import { SettingsModule } from '../settings/settings.module'

@Module({
  imports: [SettingsModule],
  controllers: [ReconcileController],
  providers: [ReconcileService, CommitterService, StateRefreshService, StateRefreshSchedulerService],
})
export class ReconcileModule {}
