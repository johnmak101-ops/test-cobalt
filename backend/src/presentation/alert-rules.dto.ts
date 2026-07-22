import { Type } from 'class-transformer'
import {
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export const ALERT_SEVERITIES = ['CRITICAL', 'WARNING', 'INFO'] as const

/**
 * One editable rule in PUT /alert-rules. Identity/anchor fields (name, state, trigger*) are
 * server-owned — the whitelist pipe strips them if a client echoes them back. countryThresholds
 * stays a free-form map here (no @Type(() => Object) — see review/dto.ts for why) and is
 * sanitized in PresentationService.saveAlertRules (codes CN/BD/KH, days 1-30).
 */
export class AlertRuleUpdateDto {
  @IsString() id!: string
  @IsOptional() @IsInt() @Min(0) @Max(30) thresholdDays?: number
  @IsOptional() @IsIn(ALERT_SEVERITIES as unknown as string[]) severity?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @Allow() countryThresholds?: Record<string, number> | null
}

export class SaveAlertRulesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AlertRuleUpdateDto) rules!: AlertRuleUpdateDto[]
}
