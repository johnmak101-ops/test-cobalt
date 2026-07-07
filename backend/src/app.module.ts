import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { LoggerModule } from 'nestjs-pino'
import { ServeStaticModule } from '@nestjs/serve-static'
import { validateEnv } from './config/env.validation'
import { loggerParams } from './logging/logging.options'
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
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Structured logging (pino): JSON to stdout + a rotating logs/backend.<date>.<n>.log, per-request req.id.
    LoggerModule.forRoot(loggerParams()),
    // Single-image deploy (Docker): when STATIC_ROOT points at the built SPA, the backend also serves it,
    // so one container answers both the UI (/) and the API (/api). Unset in local dev (Vite serves the UI),
    // so this is a no-op there. The API keeps its /api prefix; /api/* is excluded from static fallback.
    ...(process.env.STATIC_ROOT
      ? [ServeStaticModule.forRoot({ rootPath: process.env.STATIC_ROOT, exclude: ['/api/{*splat}'] })]
      : []),
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
