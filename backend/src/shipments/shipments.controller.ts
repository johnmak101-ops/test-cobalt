import { Controller, Get, Param, Query } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'

const STRONG_KEYS = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no']

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  /**
   * GET /api/shipments
   *  - with strong-key params (so_no, booking_no, …) → Matcher candidate lookup (Agent VM)
   *  - otherwise → the Shipment Tracker list for the UI (optional ?status filter)
   */
  @Get() index(@Query() q: Record<string, string>) {
    const hasKeys = STRONG_KEYS.some((k) => q[k] != null && q[k] !== '')
    return hasKeys ? this.shipments.lookupByMatchKey(q) : this.shipments.listForTracker(q.status)
  }

  @Get(':id') getOne(@Param('id') id: string) {
    return this.shipments.getOne(id)
  }
}
