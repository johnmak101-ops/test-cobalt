import { Body, Controller, Get, Post, Query, BadRequestException } from '@nestjs/common'
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'
import { MeshMissesService, MESH_MISS_DEFAULT_DAYS } from './mesh-misses.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

class AckDto {
  @IsIn(['vendor', 'forwarder', 'customer'])
  type!: 'vendor' | 'forwarder' | 'customer'

  @IsString()
  @MinLength(1)
  @MaxLength(400)
  normalizedName!: string
}

function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  return /2627|unique|duplicate/i.test(msg)
}

/** Admin Mesh-miss worklist (structured criticReview.masterMisses aggregation). */
@Controller('admin/mesh-misses')
export class MeshMissesController {
  constructor(private readonly meshMisses: MeshMissesService) {}

  @Roles('ADMIN')
  @Get()
  list(
    @Query('days') daysRaw?: string,
    @Query('includeAcked') includeAckedRaw?: string,
  ) {
    const parsed = daysRaw != null ? Number(daysRaw) : NaN
    const days = Number.isFinite(parsed) && parsed > 0 ? parsed : MESH_MISS_DEFAULT_DAYS
    const includeAcked = includeAckedRaw === 'true' || includeAckedRaw === '1'
    return this.meshMisses.list(days, includeAcked)
  }

  @Roles('ADMIN')
  @Post('ack')
  async ack(@Body() dto: AckDto, @CurrentUser() actor: AuthUser) {
    try {
      await this.meshMisses.ack(dto.type, dto.normalizedName, actor?.email ?? actor?.id ?? 'admin')
    } catch (e) {
      // Concurrent double-ack on unique (type, normalized_name) → idempotent success
      if (isUniqueViolation(e)) return { ok: true }
      // Never rethrow e.message (DbExceptionFilter exists to sanitize SQL leaks)
      throw new BadRequestException('ack failed')
    }
    return { ok: true }
  }
}
