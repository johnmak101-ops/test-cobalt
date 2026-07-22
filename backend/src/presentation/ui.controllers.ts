/**
 * UI-facing read controllers for paths that DON'T collide with existing controllers.
 * (The colliding GETs — /shipments, /shipments/:id, /alerts — are delegated from the existing
 * controllers to PresentationService instead, to preserve the agent-matcher branch.)
 * All are protected by the global JwtAuthGuard.
 */
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { PresentationService } from './presentation.service'
import { EmailPresentationService } from './email-presentation.service'
import { DocumentPresentationService } from './document-presentation.service'
import { PurchaseOrderPresentationService } from './purchase-order-presentation.service'
import { MasterDataPresentationService } from './master-data-presentation.service'
import { CurrentUser, Roles } from '../auth/decorators'
import { PageRead, PageWrite } from '../access/page-access.decorators'
import { SaveAlertRulesDto } from './alert-rules.dto'

@Controller('dashboard')
export class UiDashboardController {
  constructor(private readonly ui: PresentationService) {}

  @Get() get() {
    return this.ui.dashboard()
  }
}

@Controller()
export class UiMastersController {
  constructor(private readonly ui: MasterDataPresentationService) {}

  @Get('vendors') vendors(@Query('q') q?: string, @Query('type') type?: string) {
    return this.ui.vendors(q, type)
  }
  @Get('forwarders') forwarders(@Query('q') q?: string) {
    return this.ui.forwarders(q)
  }
  @Get('customers') customers(@Query('q') q?: string) {
    return this.ui.customers(q)
  }
  @Get('consignees') consignees(@Query('q') q?: string) {
    return this.ui.consignees(q)
  }
}

@Controller('alert-rules')
export class UiAlertRulesController {
  constructor(private readonly ui: PresentationService) {}

  @PageRead('alert_rules')
  @Get() get() {
    return this.ui.alertRules()
  }
  // Governed by the configurable Access Control matrix (page 'alert_rules'): reading needs View,
  // saving needs Edit; superadmin always passes. Paired with the frontend PageAccessRoute + canEdit.
  @PageWrite('alert_rules')
  @Put() save(@Body() body: SaveAlertRulesDto) {
    return this.ui.saveAlertRules(body)
  }
  /** True factory reset (thresholds, severity, country overrides, enabled) — same Edit gate as save. */
  @PageWrite('alert_rules')
  @Post('reset') reset() {
    return this.ui.resetAlertRules()
  }
}

@Controller('shipments')
export class UiShipmentHistoryController {
  constructor(private readonly ui: PresentationService) {}

  @Get(':id/history') history(@Param('id') id: string) {
    return this.ui.shipmentHistory(id)
  }
}

@Controller('documents')
export class UiDocumentsController {
  constructor(private readonly ui: DocumentPresentationService) {}

  @Get() list() {
    return this.ui.documents()
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.ui.document(id)
  }
  @Roles('EDITOR', 'ADMIN')
  @Post(':id/link') link(@Param('id') id: string, @Body() body: { shipmentId: string }) {
    return this.ui.linkDocument(id, body?.shipmentId)
  }
  @Roles('EDITOR', 'ADMIN')
  @Post(':id/dismiss') dismiss(@Param('id') id: string) {
    return this.ui.dismissDocument(id)
  }
}

@Controller('purchase-orders')
export class UiPosController {
  constructor(private readonly ui: PurchaseOrderPresentationService) {}

  @Get() list(@Query('customerId') customerId?: string, @Query('open') open?: string) {
    return this.ui.purchaseOrders({ customerId, open: open === 'true' })
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.ui.purchaseOrder(id)
  }
}

@Controller('emails')
export class UiEmailsController {
  constructor(private readonly ui: EmailPresentationService) {}

  @Get() list() {
    return this.ui.emails()
  }
  @Get('unread-count') unreadCount() {
    return this.ui.emailsUnreadCount()
  }
  @Get(':id/attachments') attachments(@Param('id') id: string) {
    return this.ui.emailAttachments(id)
  }
  @Get(':id/body') body(@Param('id') id: string) {
    return this.ui.emailBody(id)
  }
  @Get(':id/thread') thread(@Param('id') id: string) {
    return this.ui.emailThread(id)
  }
  @Patch(':id/read') markRead(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.ui.emailMarkRead(id, user.id)
  }
}
