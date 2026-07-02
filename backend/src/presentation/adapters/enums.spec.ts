import { describe, it, expect } from 'vitest'
import { stateToUiStatus, mapBackendRoleToUi, thresholdHoursToDays } from './enums'

describe('stateToUiStatus — leg state -> UI status (update-summary terminology)', () => {
  it('maps the 6 leg states onto the UI staircase positionally', () => {
    expect(stateToUiStatus('BOOKED')).toBe('BOOKED')
    expect(stateToUiStatus('CONFIRMED')).toBe('CONFIRMED')
    expect(stateToUiStatus('AT_WAREHOUSE')).toBe('AT_WAREHOUSE')
    expect(stateToUiStatus('SAILED')).toBe('SAILED')
    expect(stateToUiStatus('RELEASED')).toBe('DEPARTED')
    expect(stateToUiStatus('DELIVERED')).toBe('ARRIVED')
  })

  it('defaults null/undefined/unknown to BOOKED', () => {
    expect(stateToUiStatus(null)).toBe('BOOKED')
    expect(stateToUiStatus(undefined)).toBe('BOOKED')
    expect(stateToUiStatus('SOMETHING_ELSE')).toBe('BOOKED')
  })
})

describe('mapBackendRoleToUi — 4 backend roles -> 4 UI labels (display only)', () => {
  it('maps each backend role to a UI role', () => {
    expect(mapBackendRoleToUi('VIEWER')).toBe('COORDINATOR')
    expect(mapBackendRoleToUi('EDITOR')).toBe('MANAGER')
    expect(mapBackendRoleToUi('ADMIN')).toBe('ADMIN')
    // SUPERADMIN keeps its own label — the UI gates the Settings page on it
    expect(mapBackendRoleToUi('SUPERADMIN')).toBe('SUPERADMIN')
  })

  it('defaults null/undefined/unknown to least-privilege COORDINATOR', () => {
    expect(mapBackendRoleToUi(null)).toBe('COORDINATOR')
    expect(mapBackendRoleToUi(undefined)).toBe('COORDINATOR')
    expect(mapBackendRoleToUi('ROBOT')).toBe('COORDINATOR')
  })
})

describe('thresholdHoursToDays — alert rule unit conversion', () => {
  it('converts hours to whole days (rounded)', () => {
    expect(thresholdHoursToDays(0)).toBe(0)
    expect(thresholdHoursToDays(24)).toBe(1)
    expect(thresholdHoursToDays(48)).toBe(2)
    expect(thresholdHoursToDays(72)).toBe(3)
    expect(thresholdHoursToDays(36)).toBe(2) // 1.5 -> 2 (round half up)
  })

  it('treats null/undefined/non-finite as 0 days', () => {
    expect(thresholdHoursToDays(null)).toBe(0)
    expect(thresholdHoursToDays(undefined)).toBe(0)
    expect(thresholdHoursToDays(Number.NaN)).toBe(0)
  })
})
