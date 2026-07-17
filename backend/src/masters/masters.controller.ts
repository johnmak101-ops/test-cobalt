import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { MastersService } from './masters.service'
import { CandidatesService } from './candidates.service'
import { MastersSyncSchedulerService } from './masters-sync-scheduler.service'
import { PortsSyncSchedulerService } from './ports-sync-scheduler.service'
import { Roles, CurrentUser } from '../auth/decorators'
import { AgentPageRead, PageRead, PageWrite } from '../access/page-access.decorators'
import type { AuthUser } from '../auth/auth.service'
import {
  CreateForwarderDto,
  UpdateForwarderDto,
  CreatePortDto,
  UpdatePortDto,
  CreateConsigneeDto,
  UpdateConsigneeDto,
  CreateCarrierDto,
  UpdateCarrierDto,
  CreateResolutionFactDto,
  PatchResolutionFactDto,
  MasterCandidatesDto,
} from './dto'

@Controller('masters')
export class MastersController {
  constructor(
    private readonly masters: MastersService,
    private readonly candidatesService: CandidatesService,
    private readonly meshSync: MastersSyncSchedulerService,
    private readonly portsSync: PortsSyncSchedulerService,
  ) {}

  // Reads — any authenticated user.
  @Get('customers') customers() { return this.masters.customers() }
  @Get('vendors') vendors() { return this.masters.vendors() }
  @Get('forwarders') forwarders() { return this.masters.forwarders() }
  @Get('ports') ports() { return this.masters.ports() }
  @Get('consignees') consignees() { return this.masters.consignees() }
  @Get('carriers') carriers() { return this.masters.carriers() }

  /** Unmatched forwarder/port raw values (admin curation) — #145. */
  @PageRead('resolution_rules')
  @Get('unmatched') unmatched() { return this.masters.unmatched() }

  // Candidate retrieval for the LLM Master Matcher — agent-consumed (cobalt-queue Bearer EDITOR+).
  // Access-control v2: hard page-read gate for VIEWER/none + EDITOR+ service-account carve-out.
  @AgentPageRead('resolution_rules')
  @Post('candidates') candidates(@Body() dto: MasterCandidatesDto) { return this.candidatesService.candidates(dto) }

  /** Manual Mesh masters pull (customers/vendors/forwarders). ADMIN only — shiptrack#161. */
  @Roles('ADMIN')
  @Post('sync')
  syncNow() {
    return this.meshSync.tick('http')
  }

  /** Manual UN/LOCODE + OurAirports ports pull. ADMIN only — shiptrack#159. */
  @Roles('ADMIN')
  @Post('ports/sync')
  syncPortsNow() {
    return this.portsSync.tick('http')
  }

  // Master resolution (curated facts) + the curator loop.
  // Access-control v2: same hard-read + agent carve-out (was fully ungated for any authenticated user).
  @AgentPageRead('resolution_rules')
  @Get('resolution') resolution() { return this.masters.resolution() }
  // Resolution Rules page — governed by the Access Control matrix (page 'resolution_rules'):
  // management reads need View, mutations need Edit; superadmin always passes.
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
  @Roles('ADMIN') @Post('carriers') createCarrier(@Body() dto: CreateCarrierDto) {
    return this.masters.createCarrier(dto)
  }
  @Roles('ADMIN') @Patch('carriers/:id') updateCarrier(@Param('id') id: string, @Body() dto: UpdateCarrierDto) {
    return this.masters.updateCarrier(id, dto)
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
