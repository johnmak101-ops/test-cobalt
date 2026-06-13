import { Controller, Get } from '@nestjs/common'
import { MastersService } from './masters.service'

@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get('customers') customers() { return this.masters.customers() }
  @Get('vendors') vendors() { return this.masters.vendors() }
  @Get('forwarders') forwarders() { return this.masters.forwarders() }
  @Get('ports') ports() { return this.masters.ports() }
  @Get('consignees') consignees() { return this.masters.consignees() }
}
