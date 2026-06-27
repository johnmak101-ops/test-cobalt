import { Controller, Get, Param, Query } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'

const STRONG_KEYS = ['so_no', 'booking_no', 'hbl_awb_fcr_no', 'mbl', 'container_no']

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  /**
   * GET /api/shipments
   *  - with a match key (a strong key OR customer_po) → Matcher candidate lookup (Agent VM). customer_po
   *    MUST route here too: a PO-only email needs to learn whether the PO already lives on a leg, else the
   *    Matcher sees zero candidates and (wrongly) treats every known PO as a brand-new shipment.
   *  - otherwise → the Shipment Tracker list for the UI (optional ?status filter)
   */
  @Get() index(@Query() q: Record<string, string>) {
    const present = (k: string) => q[k] != null && q[k] !== ''
    const hasKeys = STRONG_KEYS.some(present) || present('customer_po')
    return hasKeys ? this.shipments.lookupByMatchKey(q) : this.shipments.listForTracker(q.status)
  }

  @Get(':id') getOne(@Param('id') id: string) {
    return this.shipments.getOne(id)
  }
}
