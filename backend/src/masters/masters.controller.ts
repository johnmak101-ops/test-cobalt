import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { MastersService } from './masters.service'
import { Roles } from '../auth/decorators'
import {
  CreateForwarderDto,
  UpdateForwarderDto,
  CreatePortDto,
  UpdatePortDto,
  CreateConsigneeDto,
  UpdateConsigneeDto,
} from './dto'

@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  // Reads — any authenticated user.
  @Get('customers') customers() { return this.masters.customers() }
  @Get('vendors') vendors() { return this.masters.vendors() }
  @Get('forwarders') forwarders() { return this.masters.forwarders() }
  @Get('ports') ports() { return this.masters.ports() }
  @Get('consignees') consignees() { return this.masters.consignees() }

  // Writes — ADMIN+ , Ops-maintained masters only (customers/vendors are an ERP mirror).
  @Roles('ADMIN') @Post('forwarders') createForwarder(@Body() dto: CreateForwarderDto) {
    return this.masters.createForwarder(dto)
  }
  @Roles('ADMIN') @Patch('forwarders/:id') updateForwarder(@Param('id') id: string, @Body() dto: UpdateForwarderDto) {
    return this.masters.updateForwarder(id, dto)
  }
  @Roles('ADMIN') @Post('ports') createPort(@Body() dto: CreatePortDto) {
    return this.masters.createPort(dto)
  }
  @Roles('ADMIN') @Patch('ports/:id') updatePort(@Param('id') id: string, @Body() dto: UpdatePortDto) {
    return this.masters.updatePort(id, dto)
  }
  @Roles('ADMIN') @Post('consignees') createConsignee(@Body() dto: CreateConsigneeDto) {
    return this.masters.createConsignee(dto)
  }
  @Roles('ADMIN') @Patch('consignees/:id') updateConsignee(@Param('id') id: string, @Body() dto: UpdateConsigneeDto) {
    return this.masters.updateConsignee(id, dto)
  }
}
