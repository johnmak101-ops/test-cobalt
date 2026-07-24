import { Body, Controller, Get, Put, Query } from '@nestjs/common'
import { IsIn, IsInt, Max, Min } from 'class-validator'
import { SettingsService } from './settings.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

class ThresholdDto {
  @IsInt() @Min(0) @Max(100) value!: number
}

class RoutingModeDto {
  @IsIn(['gate', 'band']) mode!: 'gate' | 'band'
}

class EtdFallbackDto {
  @IsInt() @Min(0) @Max(365) airDays!: number
  @IsInt() @Min(0) @Max(365) seaDays!: number
}

/** Admin config — review-gate confidence threshold + critic routing mode. Editors+ read; admins change. */
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

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

  /** No-arrival-data Delivered fallback: departure + these day allowances ⇒ Delivered.
   *  ADMIN+ read AND write — the Settings tab itself is admin-only (SUPERADMIN passes via guard). */
  @Roles('ADMIN')
  @Get('etd-fallback')
  async getEtdFallback() {
    return this.settings.etdFallback()
  }

  @Roles('ADMIN')
  @Put('etd-fallback')
  async setEtdFallback(@Body() dto: EtdFallbackDto, @CurrentUser() actor: AuthUser) {
    await this.settings.setEtdFallback({ airDays: dto.airDays, seaDays: dto.seaDays }, actor.id)
    return { airDays: dto.airDays, seaDays: dto.seaDays }
  }

  /** Gate vs band shadow-diff summary for the last N days (EDITOR+). */
  @Roles('EDITOR', 'ADMIN')
  @Get('routing-shadow')
  async routingShadowReport(@Query('days') daysRaw?: string) {
    return this.settings.routingShadowReport(daysRaw)
  }

  /** Band vs human-outcome calibration for Phase 2b flip decision (EDITOR+). */
  @Roles('EDITOR', 'ADMIN')
  @Get('critic-calibration')
  async criticCalibrationReport(@Query('days') daysRaw?: string) {
    return this.settings.criticCalibrationReport(daysRaw)
  }
}
