import { Body, Controller, Get, Put } from '@nestjs/common'
import { IsInt, Max, Min } from 'class-validator'
import { SettingsService } from './settings.service'
import { Roles, CurrentUser } from '../auth/decorators'
import type { AuthUser } from '../auth/auth.service'

class ThresholdDto {
  @IsInt() @Min(0) @Max(100) value!: number
}

/** Admin config — the review-gate confidence threshold. Editors+ read it; admins change it. */
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
}
