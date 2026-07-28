import { Module } from '@nestjs/common'
import { MastersController } from './masters.controller'
import { MastersService } from './masters.service'
import { CandidatesService } from './candidates.service'
import { MastersSyncSchedulerService } from './masters-sync-scheduler.service'
import { PortsSyncService } from './ports-sync.service'
import { PortsSyncSchedulerService } from './ports-sync-scheduler.service'
import { PartyRelinkService } from './party-relink.service'

@Module({
  controllers: [MastersController],
  providers: [
    MastersService,
    CandidatesService,
    MastersSyncSchedulerService,
    PartyRelinkService,
    PortsSyncService,
    PortsSyncSchedulerService,
  ],
  exports: [MastersSyncSchedulerService, PortsSyncSchedulerService, PortsSyncService, PartyRelinkService],
})
export class MastersModule {}
