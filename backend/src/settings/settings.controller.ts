import { Body, Controller, Get, Put } from '@nestjs/common'
import { IsArray, IsIn, IsInt, IsString, Max, Min } from 'class-validator'
import { SettingsService } from './settings.service'
import { Roles, CurrentUser } from '../auth/decorators'
import { PageRead, PageWrite } from '../access/page-access.decorators'
import { REVIEW_TRIGGER_IDS } from '../decisions/review-policy'
import type { AuthUser } from '../auth/auth.service'

class ThresholdDto {
  @IsInt() @Min(0) @Max(100) value!: number
}

class ReviewPolicyDto {
  @IsArray() @IsString({ each: true }) @IsIn(REVIEW_TRIGGER_IDS, { each: true }) enabled!: string[]
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

  // Review Policy — governed by the Access Control matrix (page 'review_policy'): View to read,
  // Edit to change. Default gives EDITOR (Manager) edit; superadmin can adjust per role.
  @PageRead('review_policy')
  @Get('review-policy')
  getReviewPolicy() {
    return this.settings.reviewPolicyView()
  }

  @PageWrite('review_policy')
  @Put('review-policy')
  setReviewPolicy(@Body() dto: ReviewPolicyDto, @CurrentUser() actor: AuthUser) {
    return this.settings.setReviewPolicy(dto.enabled, actor.id)
  }
}
