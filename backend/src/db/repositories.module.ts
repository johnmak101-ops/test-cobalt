import { Global, Module } from '@nestjs/common'
import { MastersRepository } from './repositories/masters.repository'
import { BookingRepository } from './repositories/booking.repository'
import { ShipmentRepository } from './repositories/shipment.repository'
import { FieldLockRepository } from './repositories/field-lock.repository'
import { AuditRepository } from './repositories/audit.repository'
import { AlertRepository } from './repositories/alert.repository'
import { EvidenceRepository } from './repositories/evidence.repository'
import { UsersRepository } from './repositories/users.repository'
import { SettingsRepository } from './repositories/settings.repository'

const repositories = [
  MastersRepository,
  BookingRepository,
  ShipmentRepository,
  FieldLockRepository,
  AuditRepository,
  AlertRepository,
  EvidenceRepository,
  UsersRepository,
  SettingsRepository,
]

/** Global so any service can inject a repository without re-importing. */
@Global()
@Module({
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
