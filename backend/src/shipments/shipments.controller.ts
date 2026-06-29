import { Controller, Get, Param, Query } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'
import { PresentationService } from '../presentation/presentation.service'

const STRONG_KEYS = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no']

@Controller('shipments')
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly ui: PresentationService,
  ) {}

  /**
   * GET /api/shipments
   *  - with a match key (a strong key OR customer_po) → Matcher candidate lookup (Agent VM), unchanged.
   *  - otherwise → the UI Shipment Tracker list (flat projection), with optional status/customerId/forwarderId filters.
   */
  @Get() index(@Query() q: Record<string, string>) {
    const present = (k: string) => q[k] != null && q[k] !== ''
    const hasKeys = STRONG_KEYS.some(present) || present('customer_po')
    if (hasKeys) return this.shipments.lookupByMatchKey(q)
    return this.ui.shipments({ status: q.status, customerId: q.customerId, forwarderId: q.forwarderId })
  }

  @Get(':id') getOne(@Param('id') id: string) {
    return this.ui.shipment(id)
  }
}
