import { Controller, Get, Query } from '@nestjs/common'
import { Roles } from '../auth/decorators'
import { ErpExportService, type ErpExportQuery } from './erp-export.service'

/**
 * ERP export — read-only JSON feed for the PO-based ERP (Mesh) and the PO-lookup chatbot.
 * EDITOR+ (rank-based, so ADMIN/SUPERADMIN pass): outward-facing full-data export is an
 * operational surface, not a viewer one. The IT consumer authenticates with a service account.
 */
@Controller('erp-export')
export class ErpExportController {
  constructor(private readonly erpExport: ErpExportService) {}

  /** The field catalog — what `fields=` can ask for, with groups and descriptions. */
  @Roles('EDITOR')
  @Get('fields')
  fields() {
    return this.erpExport.listFields()
  }

  /**
   * GET /api/erp-export/pos — one object per PO, its shipment legs nested.
   * Query: since, poNumber (format-tolerant), jobNo, state, fields (comma list),
   * includeProvisional, includeCancelled, limit, offset.
   */
  @Roles('EDITOR')
  @Get('pos')
  pos(@Query() q: ErpExportQuery) {
    return this.erpExport.exportPos(q ?? {})
  }
}
