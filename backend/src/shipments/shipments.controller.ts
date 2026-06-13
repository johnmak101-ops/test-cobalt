import { Controller, Get, Param } from '@nestjs/common'
import { ShipmentsService } from './shipments.service'

@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get(':id') getOne(@Param('id') id: string) { return this.shipments.getOne(id) }
}
