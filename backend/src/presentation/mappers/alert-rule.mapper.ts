/**
 * Alert rule row -> UI rule shape. Pure.
 * thresholdHours -> thresholdDays; state mapped onto the UI staircase; countryThresholds is null
 * until the Phase 3 additive column + country-aware evaluator land. Read-only for Phase 1.
 */
import { stateToUiStatus, thresholdHoursToDays } from '../adapters/enums'

export interface AlertRuleRow {
  id: string
  name: string
  description: string | null
  state: string | null
  triggerType: string
  triggerReference: string
  thresholdHours: number | null
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

export interface UiAlertRule {
  id: string
  name: string
  description: string | null
  state: string | null
  triggerType: string
  triggerReference: string
  thresholdDays: number
  countryThresholds: Record<string, number> | null
  severity: string
  enabled: boolean
  locked: boolean
}

export function toUiAlertRule(rule: AlertRuleRow): UiAlertRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? null,
    state: rule.state ? stateToUiStatus(rule.state) : null,
    triggerType: rule.triggerType,
    triggerReference: rule.triggerReference,
    thresholdDays: thresholdHoursToDays(rule.thresholdHours),
    countryThresholds: rule.countryThresholds
      ? Object.fromEntries(
          Object.entries(rule.countryThresholds).map(([country, hours]) => [country, thresholdHoursToDays(hours)]),
        )
      : null,
    severity: rule.severity,
    enabled: rule.enabled,
    locked: rule.locked,
  }
}
