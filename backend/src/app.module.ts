import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DrizzleModule } from './db/drizzle.module'
import { HealthModule } from './health/health.module'
import { MastersModule } from './masters/masters.module'
import { BookingsModule } from './bookings/bookings.module'
import { ShipmentsModule } from './shipments/shipments.module'
import { PosModule } from './pos/pos.module'
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module'
import { ReconcileModule } from './reconcile/reconcile.module'
import { DecisionsModule } from './decisions/decisions.module'
import { ReviewModule } from './review/review.module'
import { SettingsModule } from './settings/settings.module'
import { AlertsModule } from './alerts/alerts.module'
import { EmailsModule } from './emails/emails.module'
import { RepositoriesModule } from './db/repositories.module'
import { PresentationModule } from './presentation/presentation.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    RepositoriesModule,
    PresentationModule,
    AuthModule,
    UsersModule,
    HealthModule,
    MastersModule,
    BookingsModule,
    ShipmentsModule,
    PosModule,
    PurchaseOrdersModule,
    ReconcileModule,
    DecisionsModule,
    ReviewModule,
    SettingsModule,
    AlertsModule,
    EmailsModule,
  ],
})
export class AppModule {}
