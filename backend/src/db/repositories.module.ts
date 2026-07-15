import { Global, Module } from '@nestjs/common'
import { MastersRepository } from './repositories/masters.repository'
import { BookingRepository } from './repositories/booking.repository'
import { PurchaseOrderRepository } from './repositories/purchase-order.repository'
import { ShipmentRepository } from './repositories/shipment.repository'
import { FieldLockRepository } from './repositories/field-lock.repository'
import { AuditRepository } from './repositories/audit.repository'
import { AlertRepository } from './repositories/alert.repository'
import { EvidenceRepository } from './repositories/evidence.repository'
import { EmailRepository } from './repositories/email.repository'
import { ReviewEmailRepository } from './repositories/review-email.repository'
import { UsersRepository } from './repositories/users.repository'
import { SettingsRepository } from './repositories/settings.repository'
import { IngestRepository } from './repositories/ingest.repository'
import { RoutingShadowRepository } from './repositories/routing-shadow.repository'
import { CriticCalibrationRepository } from './repositories/critic-calibration.repository'

const repositories = [
  MastersRepository,
  BookingRepository,
  PurchaseOrderRepository,
  ShipmentRepository,
  FieldLockRepository,
  AuditRepository,
  AlertRepository,
  EvidenceRepository,
  EmailRepository,
  ReviewEmailRepository,
  UsersRepository,
  SettingsRepository,
  IngestRepository,
  RoutingShadowRepository,
  CriticCalibrationRepository,
]

/** Global so any service can inject a repository without re-importing. */
@Global()
@Module({
  providers: repositories,
  exports: repositories,
})
export class RepositoriesModule {}
