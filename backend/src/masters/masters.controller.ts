import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { MastersService } from './masters.service'
import { CandidatesService } from './candidates.service'
import { Roles, CurrentUser } from '../auth/decorators'
import { PageRead, PageWrite } from '../access/page-access.decorators'
import type { AuthUser } from '../auth/auth.service'
import {
  CreateForwarderDto,
  UpdateForwarderDto,
  CreatePortDto,
  UpdatePortDto,
  CreateConsigneeDto,
  UpdateConsigneeDto,
  CreateResolutionFactDto,
  PatchResolutionFactDto,
  MasterCandidatesDto,
} from './dto'

@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService, private readonly candidatesService: CandidatesService) {}

  // Reads — any authenticated user.
  @Get('customers') customers() { return this.masters.customers() }
  @Get('vendors') vendors() { return this.masters.vendors() }
  @Get('forwarders') forwarders() { return this.masters.forwarders() }
  @Get('ports') ports() { return this.masters.ports() }
  @Get('consignees') consignees() { return this.masters.consignees() }

  // Candidate retrieval for the LLM Master Matcher — agent-consumed (cobalt-queue Bearer service
  // account), same ungated surface as the consumer `GET resolution` below. Deterministic + LLM-free.
  @Post('candidates') candidates(@Body() dto: MasterCandidatesDto) { return this.candidatesService.candidates(dto) }

  // Master resolution (curated facts) + the curator loop.
  @Get('resolution') resolution() { return this.masters.resolution() }
  // Resolution Rules page — governed by the Access Control matrix (page 'resolution_rules'):
  // management reads need View, mutations need Edit; superadmin always passes. The consumer read
  // `GET resolution` above stays UNGATED — cobalt-queue's parser reads it over HTTP.
  @Get('resolution/manage') @PageRead('resolution_rules') resolutionManage() { return this.masters.resolutionManage() }
  @PageWrite('resolution_rules') @Post('resolution') createFact(@Body() dto: CreateResolutionFactDto, @CurrentUser() u: AuthUser) {
    return this.masters.createFact(dto, u.id)
  }
  @PageWrite('resolution_rules') @Patch('resolution/:id') patchFact(@Param('id') id: string, @Body() dto: PatchResolutionFactDto) {
    return this.masters.patchReason(id, dto.reason)
  }
  @PageWrite('resolution_rules') @Post('resolution/:id/deactivate') deactivateFact(@Param('id') id: string) {
    return this.masters.deactivate(id)
  }
  @PageWrite('resolution_rules') @Post('resolution/:id/reactivate') reactivateFact(@Param('id') id: string) {
    return this.masters.reactivate(id)
  }
  @PageRead('resolution_rules') @Get('proposals') proposals() { return this.masters.proposals() }
  @PageWrite('resolution_rules') @Post('curate') curate() { return this.masters.curate() }
  @PageWrite('resolution_rules') @Post('proposals/:id/approve') approveProposal(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.masters.approveProposal(id, u.id)
  }
  @PageWrite('resolution_rules') @Post('proposals/:id/reject') rejectProposal(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.masters.rejectProposal(id, u.id)
  }

  // Writes — ADMIN+ , Ops-maintained masters only (customers/vendors are a Cobalt Mesh API mirror).
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
