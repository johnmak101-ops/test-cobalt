/**
 * UI-facing read controllers for paths that DON'T collide with existing controllers.
 * (The colliding GETs — /shipments, /shipments/:id, /alerts — are delegated from the existing
 * controllers to PresentationService instead, to preserve the agent-matcher branch.)
 * All are protected by the global JwtAuthGuard.
 */
import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { PresentationService } from './presentation.service'
import { CurrentUser, Roles } from '../auth/decorators'

@Controller('dashboard')
export class UiDashboardController {
  constructor(private readonly ui: PresentationService) {}

  @Get() get() {
    return this.ui.dashboard()
  }
}

@Controller()
export class UiMastersController {
  constructor(private readonly ui: PresentationService) {}

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

  @Get() get() {
    return this.ui.alertRules()
  }
  @Roles('EDITOR', 'ADMIN')
  @Put() save(@Body() body: { rules?: Array<Record<string, unknown>> }) {
    return this.ui.saveAlertRules(body)
  }
}

@Controller('shipments')
export class UiShipmentHistoryController {
  constructor(private readonly ui: PresentationService) {}

  @Get(':id/history') history(@Param('id') id: string) {
    return this.ui.shipmentHistory(id)
  }
}

@Controller('purchase-orders')
export class UiPosController {
  constructor(private readonly ui: PresentationService) {}

  @Get() list(@Query('customerId') customerId?: string, @Query('open') open?: string) {
    return this.ui.purchaseOrders({ customerId, open: open === 'true' })
  }
  @Get(':id') detail(@Param('id') id: string) {
    return this.ui.purchaseOrder(id)
  }
}

@Controller('emails')
export class UiEmailsController {
  constructor(private readonly ui: PresentationService) {}

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
  @Patch(':id/read') markRead(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.ui.emailMarkRead(id, user.id)
  }
}

@Controller('email-integrations')
export class UiEmailIntegrationController {
  constructor(private readonly ui: PresentationService) {}

  @Get() get() {
    return this.ui.emailIntegration()
  }
  @Roles('ADMIN') @Put() save() {
    return this.ui.emailIntegrationSave()
  }
  @Roles('ADMIN') @Post('test') test() {
    return this.ui.emailIntegrationTest()
  }
  @Roles('ADMIN') @Post('sync') sync() {
    return this.ui.emailIntegrationSync()
  }
}
