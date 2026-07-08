import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { PageAccessService } from './page-access.service'
import { PageAccessController } from './page-access.controller'
import { PageAccessGuard } from './page-access.guard'

/**
 * Superadmin-managed config-page access control. SettingsRepository comes from the global
 * RepositoriesModule. PageAccessGuard is registered as a global APP_GUARD (no-op on routes without
 * @PageRead/@PageWrite), so it must be after the auth guards — AuthModule is imported before this.
 */
@Module({
  controllers: [PageAccessController],
  providers: [PageAccessService, { provide: APP_GUARD, useClass: PageAccessGuard }],
  exports: [PageAccessService],
})
export class AccessModule {}
