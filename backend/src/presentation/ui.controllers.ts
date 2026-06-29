/**
 * UI-facing read controllers for paths that DON'T collide with existing controllers.
 * (The colliding GETs — /shipments, /shipments/:id, /alerts — are delegated from the existing
 * controllers to PresentationService instead, to preserve the agent-matcher branch.)
 * All are protected by the global JwtAuthGuard.
 */
import { Controller, Get, Param, Query } from '@nestjs/common'
import { PresentationService } from './presentation.service'

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
