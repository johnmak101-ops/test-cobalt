import { Module } from '@nestjs/common'
import { ErpExportController } from './erp-export.controller'
import { ErpExportService } from './erp-export.service'

/** ERP export seam (repositories come from the global RepositoriesModule). */
@Module({
  controllers: [ErpExportController],
  providers: [ErpExportService],
})
export class ErpExportModule {}
