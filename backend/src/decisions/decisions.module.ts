import { Module } from '@nestjs/common'
import { DecisionsController } from './decisions.controller'
import { DecisionsService } from './decisions.service'
import { CommitterService } from '../reconcile/committer.service'
import { SettingsModule } from '../settings/settings.module'

/** The repositories CommitterService and DecisionsService depend on (MastersRepository, BookingRepository,
 *  ShipmentRepository, FieldLockRepository, AuditRepository, EvidenceRepository, IngestRepository) all come
 *  from the global RepositoriesModule — nothing to import here. */
@Module({
  imports: [SettingsModule],
  controllers: [DecisionsController],
  providers: [DecisionsService, CommitterService],
})
export class DecisionsModule {}
