import { Module } from '@nestjs/common'
import { ReconcileController } from './reconcile.controller'
import { ReconcileService } from './reconcile.service'
import { CommitterService } from './committer.service'
import { SettingsModule } from '../settings/settings.module'

@Module({
  imports: [SettingsModule],
  controllers: [ReconcileController],
  providers: [ReconcileService, CommitterService],
})
export class ReconcileModule {}
