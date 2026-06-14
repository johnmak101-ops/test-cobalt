import { Module } from '@nestjs/common'
import { SettingsService } from './settings.service'

/** SettingsRepository comes from the global RepositoriesModule; the admin config controller (Phase E)
 *  will be added here later. */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
