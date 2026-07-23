/**
 * Factory catalogue for the two single-severity customer rules (Settings → Alert Rules).
 * Read by seed.ts for fresh installs and structural sync. It was also the source for
 * POST /alert-rules/reset until that route was removed with its button (2026-07-23); `pnpm seed` is
 * now the one way back to factory thresholds, so this catalogue stays the single definition.
 */
export interface AlertRuleFactoryRow {
  id: string
  name: string
  description: string
  state: null
  triggerType: 'days_after'
  triggerReference: 'etd'
  watchFor: 'draft_bl' | 'final_bl'
  thresholdHours: number
  countryThresholds: null
  severity: 'WARNING'
  computeTz: 'server'
  enabled: true
  locked: false
}

export const ALERT_RULE_FACTORY_DEFAULTS: AlertRuleFactoryRow[] = [
  {
    id: 'A1',
    name: 'No Draft BOL received',
    description: 'Fires after ETD when Draft B/L is still missing',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    watchFor: 'draft_bl',
    thresholdHours: 24,
    countryThresholds: null,
    severity: 'WARNING',
    computeTz: 'server',
    enabled: true,
    locked: false,
  },
  {
    id: 'A3',
    name: 'No Final BOL received',
    description: 'Fires after ETD when Final B/L is still missing',
    state: null,
    triggerType: 'days_after',
    triggerReference: 'etd',
    watchFor: 'final_bl',
    thresholdHours: 72,
    countryThresholds: null,
    severity: 'WARNING',
    computeTz: 'server',
    enabled: true,
    locked: false,
  },
]

/** Origin countries that may carry a per-rule threshold override. Anything else is dropped on save. */
export const ALERT_COUNTRY_CODES = ['CN', 'BD', 'KH'] as const

/** The critical tiers of the old warn/critical pairs — retired (disabled + locked), never deleted. */
export const RETIRED_ALERT_RULE_IDS = ['A2', 'A4'] as const
