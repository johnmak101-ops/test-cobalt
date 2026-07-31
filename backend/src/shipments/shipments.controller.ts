import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { ShipmentsService, type ManualShipmentInput } from './shipments.service'
import { PresentationService } from '../presentation/presentation.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

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
   *  - with free-text `q` (and no strong keys) → compact search for Review "Move PO" target picker.
   *  - otherwise → the UI Shipment Tracker list (flat projection), with optional status/customerId/forwarderId filters.
   */
  @Get() index(@Query() q: Record<string, string>) {
    const present = (k: string) => q[k] != null && q[k] !== ''
    const hasKeys = STRONG_KEYS.some(present) || present('customer_po')
    if (hasKeys) return this.shipments.lookupByMatchKey(q)
    if (present('q')) return this.ui.searchShipments({ q: q.q, limit: Number(q.limit) || 20 })
    return this.ui.shipments({ status: q.status, customerId: q.customerId, forwarderId: q.forwarderId })
  }

  /**
   * GET /api/shipments/review-queue — Active (`pending`), Waiting (`waiting`), Rejected
   * (`dismissed`), or Approved.
   * Registered before the ':id' route so 'review-queue' is never captured as a shipment id.
   */
  @Get('review-queue') reviewQueue(@Query('view') view?: string) {
    const v =
      view === 'dismissed' || view === 'approved' || view === 'waiting' ? view : 'pending'
    return this.ui.reviewQueue(v)
  }

  /** GET /api/shipments/review-queue/counts — { provisional, waiting, dismissed } for nav + tabs. */
  @Get('review-queue/counts') reviewQueueCounts() {
    return this.ui.reviewQueueCounts()
  }

  @Get(':id') async getOne(@Param('id') id: string) {
    const [dto, contestedLocks, humanLockedFields] = await Promise.all([
      this.ui.shipment(id),
      this.shipments.contestedLocks(id),
      this.shipments.lockedFields(id),
    ])
    return { ...dto, contestedLocks, humanLockedFields }
  }

  /**
   * POST /api/shipments — human-created shipment (the pipeline never saw the booking). Minted through the
   * committer so a later agent email upserts into it (no duplicate) and human-entered fields are locked.
   * Lands provisional → the Review queue. Requires at least one identity or a PO.
   */
  @Roles('EDITOR', 'ADMIN')
  @Post() create(@Body() body: ManualShipmentInput, @CurrentUser() actor: AuthUser) {
    return this.shipments.createManual(body ?? {}, actor?.id ?? null)
  }

  /** POST /api/shipments/:id/confirm — human "approve": mark a provisional shipment confirmed. */
  @Roles('EDITOR', 'ADMIN')
  @Post(':id/confirm') confirm(@Param('id') id: string) {
    return this.ui.confirmShipment(id)
  }

  /**
   * PATCH /api/shipments/:id — human edit of shipment fields from the detail page. No @Roles: every
   * authenticated user may fill gaps the parser missed. Each edit records a field lock (the human's value,
   * kept for contested-detection — not a barrier against the agent) + audits.
   */
  @Patch(':id') edit(
    @Param('id') id: string,
    @Body() body: { fields?: Record<string, unknown>; note?: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.shipments.editFields(id, body?.fields ?? {}, actor?.id ?? null, body?.note ?? null)
  }

  /**
   * Resolve a CONTESTED field — one where a newer email overrode a human edit. No @Roles (same as edit).
   *  - keep-new: accept the newer email value (relock the field to it).
   *  - restore: put the human edit back (the email value is discarded).
   */
  @Post(':id/locks/:field/keep-new') keepNewLock(
    @Param('id') id: string,
    @Param('field') field: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.shipments.keepNewLockValue(id, field, actor?.id ?? null)
  }

  @Post(':id/locks/:field/restore') restoreLock(
    @Param('id') id: string,
    @Param('field') field: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.shipments.restoreLockValue(id, field, actor?.id ?? null)
  }
}
