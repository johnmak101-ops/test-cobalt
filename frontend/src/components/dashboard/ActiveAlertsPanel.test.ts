import { describe, it, expect } from 'vitest'
import { selectLiveAlerts } from './ActiveAlertsPanel'
import type { Alert } from '../../hooks/use-alerts'

function alert(over: Partial<Alert> & { id: string }): Alert {
  return {
    shipmentId: 's1',
    ruleId: 'r1',
    severity: 'WARNING',
    message: 'm',
    status: 'ACTIVE',
    triggeredAt: '2026-07-01T00:00:00.000Z',
    dismissedAt: null,
    snoozedUntil: null,
    readAt: null,
    ...over,
  }
}

const HOUR = 3600_000

describe('selectLiveAlerts', () => {
  it('keeps only ACTIVE alerts', () => {
    const out = selectLiveAlerts([
      alert({ id: 'a' }),
      alert({ id: 'b', status: 'DISMISSED' }),
      alert({ id: 'c', status: 'RESOLVED' }),
    ])
    expect(out.map((a) => a.id)).toEqual(['a'])
  })

  it('hides an alert whose snooze has not expired, and shows one whose snooze has', () => {
    const out = selectLiveAlerts([
      alert({ id: 'snoozed', snoozedUntil: new Date(Date.now() + HOUR).toISOString() }),
      alert({ id: 'woken', snoozedUntil: new Date(Date.now() - HOUR).toISOString() }),
    ])
    expect(out.map((a) => a.id)).toEqual(['woken'])
  })

  it('sorts CRITICAL before WARNING before INFO', () => {
    const out = selectLiveAlerts([
      alert({ id: 'info', severity: 'INFO' }),
      alert({ id: 'warn', severity: 'WARNING' }),
      alert({ id: 'crit', severity: 'CRITICAL' }),
    ])
    expect(out.map((a) => a.id)).toEqual(['crit', 'warn', 'info'])
  })

  it('sorts newest first within one severity', () => {
    const out = selectLiveAlerts([
      alert({ id: 'old', triggeredAt: '2026-07-01T00:00:00.000Z' }),
      alert({ id: 'new', triggeredAt: '2026-07-20T00:00:00.000Z' }),
    ])
    expect(out.map((a) => a.id)).toEqual(['new', 'old'])
  })

  it('does not mutate the input array', () => {
    const input = [alert({ id: 'info', severity: 'INFO' }), alert({ id: 'crit', severity: 'CRITICAL' })]
    selectLiveAlerts(input)
    expect(input.map((a) => a.id)).toEqual(['info', 'crit'])
  })
})
