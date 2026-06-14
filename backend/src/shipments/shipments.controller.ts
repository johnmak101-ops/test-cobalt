import { Controller, Get, Param, Query } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  /** Matcher lookup: GET /api/shipments?so_no=…&customer_po=… → candidate legs + locked fields. */
  @Get() lookup(@Query() q: Record<string, string>) {
    return this.shipments.lookupByMatchKey(q)
  }

  @Get(':id') getOne(@Param('id') id: string) {
    return this.shipments.getOne(id)
  }
}
