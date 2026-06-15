import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { MastersService } from './masters.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'
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

  // Master resolution (curated facts) + the curator loop.
  @Get('resolution') resolution() { return this.masters.resolution() }
  @Get('proposals') proposals() { return this.masters.proposals() }
  @Roles('ADMIN') @Post('curate') curate() { return this.masters.curate() }
  @Roles('ADMIN') @Post('proposals/:id/approve') approveProposal(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.masters.approveProposal(id, u.id)
  }
  @Roles('ADMIN') @Post('proposals/:id/reject') rejectProposal(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.masters.rejectProposal(id, u.id)
  }

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
