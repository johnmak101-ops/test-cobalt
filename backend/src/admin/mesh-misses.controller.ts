import { Body, Controller, Get, Post, Query, BadRequestException } from '@nestjs/common'
import { IsIn, IsString, MinLength } from 'class-validator'
import { MeshMissesService } from './mesh-misses.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

class AckDto {
  @IsIn(['vendor', 'forwarder', 'customer'])
  type!: 'vendor' | 'forwarder' | 'customer'

  @IsString()
  @MinLength(1)
  normalizedName!: string
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
    const days = daysRaw != null ? Number(daysRaw) : 30
    const includeAcked = includeAckedRaw === 'true' || includeAckedRaw === '1'
    return this.meshMisses.list(days, includeAcked)
  }

  @Roles('ADMIN')
  @Post('ack')
  async ack(@Body() dto: AckDto, @CurrentUser() actor: AuthUser) {
    try {
      await this.meshMisses.ack(dto.type, dto.normalizedName, actor?.email ?? actor?.id ?? 'admin')
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'ack failed')
    }
    return { ok: true }
  }
}
