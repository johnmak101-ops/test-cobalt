import { describe, it, expect, vi } from 'vitest'
import { AlertsController } from './alerts.controller'

const make = () => {
  const alerts = { list: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(), snooze: vi.fn() }
  const evaluator = { evaluate: vi.fn() }
  const ui = { alerts: vi.fn().mockResolvedValue('ui-alerts') }
  return { alerts, ui, c: new AlertsController(alerts as any, evaluator as any, ui as any) }
}

describe('AlertsController.list — UI presentation', () => {
  it('delegates the alert list to the presentation service (nested shipment shape)', () => {
    const { alerts, ui, c } = make()
    c.list('ACTIVE')
    expect(ui.alerts).toHaveBeenCalledWith('ACTIVE')
    expect(alerts.list).not.toHaveBeenCalled()
  })
})
