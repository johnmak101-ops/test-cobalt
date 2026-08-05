import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'
import { MultiBookingBackfillService } from './multi-booking-backfill.service'

class ApplyDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  shipmentIds?: string[]

  /** Must be true to apply (extra guard alongside env kill switch). */
  @IsBoolean()
  confirm!: boolean
}

/** Hybrid-C PR3: multi-booking mush inventory + flag-gated stamp (not full re-split). */
@Controller('admin/multi-booking-backfill')
export class MultiBookingBackfillController {
  constructor(private readonly backfill: MultiBookingBackfillService) {}

  @Roles('ADMIN')
  @Get()
  dryRun(
    @Query('limit') limitRaw?: string,
    @Query('includeStamped') includeStampedRaw?: string,
  ) {
    const limit = limitRaw != null ? Number(limitRaw) : undefined
    const includeStamped = includeStampedRaw === 'true' || includeStampedRaw === '1'
    return this.backfill.inventory(limit, includeStamped)
  }

  @Roles('ADMIN')
  @Post('apply')
  apply(@Body() dto: ApplyDto, @CurrentUser() actor: AuthUser) {
    if (!dto.confirm) {
      return {
        error: 'confirm must be true',
        hint: 'GET /admin/multi-booking-backfill first (dry-run), then POST with confirm:true and HYBRID_C_BACKFILL_APPLY=1',
      }
    }
    return this.backfill.apply({
      // 🔴 `change_log.actor_user_id` is a uniqueidentifier, NOT nvarchar — the id, never the email.
      // This used to read `actor?.email ?? actor?.id`, and since `AuthUser.email` is non-optional the
      // fallback could never fire: every authenticated apply sent an address into a GUID column, which
      // SQL Server rejects with 8169 AFTER the shipment row was already stamped (the two writes are not
      // one transaction) — so the stamp landed, `applied` stayed 0 and the call 500'd. Every other
      // audit.write caller in the repo passes `actor.id` or null; see the PO write controller, which
      // types its param as `{ id: string }` precisely so `.email` is not reachable.
      actor: actor?.id,
    })
  }
}
