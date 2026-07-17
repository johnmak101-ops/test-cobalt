import { Module } from '@nestjs/common'
import { MastersController } from './masters.controller'
import { MastersService } from './masters.service'
import { CandidatesService } from './candidates.service'
import { MastersSyncSchedulerService } from './masters-sync-scheduler.service'

@Module({
  controllers: [MastersController],
  providers: [MastersService, CandidatesService, MastersSyncSchedulerService],
  exports: [MastersSyncSchedulerService],
})
export class MastersModule {}
