import { Module } from '@nestjs/common'
import { DecisionsController } from './decisions.controller'
import { DecisionsService } from './decisions.service'
import { CommitterService } from '../reconcile/committer.service'
import { SettingsModule } from '../settings/settings.module'

@Module({
  imports: [SettingsModule],
  controllers: [DecisionsController],
  providers: [DecisionsService, CommitterService],
})
export class DecisionsModule {}
