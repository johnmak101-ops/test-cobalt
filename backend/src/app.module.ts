import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DrizzleModule } from './db/drizzle.module'
import { HealthModule } from './health/health.module'
import { MastersModule } from './masters/masters.module'
import { BookingsModule } from './bookings/bookings.module'
import { ShipmentsModule } from './shipments/shipments.module'
import { ReconcileModule } from './reconcile/reconcile.module'
import { AlertsModule } from './alerts/alerts.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DrizzleModule,
    HealthModule,
    MastersModule,
    BookingsModule,
    ShipmentsModule,
    ReconcileModule,
    AlertsModule,
  ],
})
export class AppModule {}
