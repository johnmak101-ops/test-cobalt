import { describe, it, expect } from 'vitest'
import { toUiAlertRule, type AlertRuleRow } from './alert-rule.mapper'

const rule = (over: Partial<AlertRuleRow> = {}): AlertRuleRow => ({
  id: 'A1',
  name: 'No Draft BOL',
  description: 'Draft B/L not received in time',
  state: 'CONFIRMED',
  triggerType: 'days_after',
  triggerReference: 'booking_request',
  thresholdHours: 48,
  severity: 'WARNING',
  enabled: true,
  locked: false,
  ...over,
})

describe('toUiAlertRule — alert rule row -> UI rule', () => {
  it('converts thresholdHours -> thresholdDays and maps state', () => {
    const r = toUiAlertRule(rule())
    expect(r.thresholdDays).toBe(2)
    expect(r.state).toBe('CONFIRMED')
    expect(r.id).toBe('A1')
    expect(r.name).toBe('No Draft BOL')
    expect(r.triggerType).toBe('days_after')
    expect(r.triggerReference).toBe('booking_request')
    expect(r.severity).toBe('WARNING')
    expect(r.enabled).toBe(true)
    expect(r.locked).toBe(false)
  })

  it('converts countryThresholds hours -> days (null when absent), to match the UI day-based editor', () => {
    expect(toUiAlertRule(rule()).countryThresholds).toBeNull()
    expect(toUiAlertRule(rule({ countryThresholds: { BD: 168, KH: 168 } })).countryThresholds).toEqual({ BD: 7, KH: 7 })
  })

  it('maps the tail state RELEASED -> DEPARTED and keeps a null (cross-state) rule null', () => {
    expect(toUiAlertRule(rule({ state: 'RELEASED' })).state).toBe('DEPARTED')
    expect(toUiAlertRule(rule({ state: null })).state).toBeNull()
  })
})
