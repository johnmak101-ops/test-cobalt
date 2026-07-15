import { Body, Controller, Get, Put, Query } from '@nestjs/common'
import { IsIn, IsInt, Max, Min } from 'class-validator'
import { SettingsService } from './settings.service'
import { aggregateRoutingShadow } from './routing-shadow-report'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'
import { RoutingShadowRepository } from '../db/repositories/routing-shadow.repository'

class ThresholdDto {
  @IsInt() @Min(0) @Max(100) value!: number
}

class RoutingModeDto {
  @IsIn(['gate', 'band']) mode!: 'gate' | 'band'
}

/** Admin config — review-gate confidence threshold + critic routing mode. Editors+ read; admins change. */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly routingShadow: RoutingShadowRepository,
  ) {}

  @Roles('EDITOR', 'ADMIN')
  @Get('threshold')
  async getThreshold() {
    return { threshold: await this.settings.confidenceThreshold() }
  }

  @Roles('ADMIN')
  @Put('threshold')
  async setThreshold(@Body() dto: ThresholdDto, @CurrentUser() actor: AuthUser) {
    await this.settings.setConfidenceThreshold(dto.value, actor.id)
    return { threshold: dto.value }
  }

  @Roles('EDITOR', 'ADMIN')
  @Get('routing-mode')
  async getRoutingMode() {
    return { mode: await this.settings.criticRoutingMode() }
  }

  @Roles('ADMIN')
  @Put('routing-mode')
  async setRoutingMode(@Body() dto: RoutingModeDto, @CurrentUser() actor: AuthUser) {
    await this.settings.setCriticRoutingMode(dto.mode, actor.id)
    return { mode: dto.mode }
  }

  /** Gate vs band shadow-diff summary for the last N days (EDITOR+). */
  @Roles('EDITOR', 'ADMIN')
  @Get('routing-shadow')
  async routingShadowReport(@Query('days') daysRaw?: string) {
    const days = Math.min(90, Math.max(1, Number(daysRaw) || 30))
    const since = new Date(Date.now() - days * 86400000)
    const rows = await this.routingShadow.listSince(since, 2000)
    return aggregateRoutingShadow(rows, days)
  }
}
