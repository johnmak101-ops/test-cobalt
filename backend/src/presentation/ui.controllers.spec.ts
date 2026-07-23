import { describe, it, expect, vi } from 'vitest'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../auth/decorators'
import { PAGE_READ_KEY, PAGE_WRITE_KEY } from '../access/page-access.decorators'
import {
  UiDashboardController,
  UiMastersController,
  UiAlertRulesController,
  UiShipmentHistoryController,
} from './ui.controllers'

const fakeSvc = () => ({
  dashboard: vi.fn().mockResolvedValue({ stats: {} }),
  vendors: vi.fn().mockResolvedValue({ vendors: [] }),
  forwarders: vi.fn().mockResolvedValue({ forwarders: [] }),
  customers: vi.fn().mockResolvedValue({ customers: [] }),
  consignees: vi.fn().mockResolvedValue({ consignees: [] }),
  alertRules: vi.fn().mockResolvedValue({ rules: [] }),
  saveAlertRules: vi.fn().mockResolvedValue({ rules: [], eval: null }),
  shipmentHistory: vi.fn().mockResolvedValue({ history: [] }),
})

describe('UiDashboardController', () => {
  it('delegates GET /dashboard to the service', async () => {
    const svc = fakeSvc()
    await new UiDashboardController(svc as any).get()
    expect(svc.dashboard).toHaveBeenCalledOnce()
  })
})

describe('UiMastersController — master search delegation', () => {
  it('passes query + type to vendors, query to the rest', async () => {
    const svc = fakeSvc()
    const c = new UiMastersController(svc as any)
    await c.vendors('ro', 'factory')
    await c.forwarders('fa')
    await c.customers('co')
    await c.consignees('ac')
    expect(svc.vendors).toHaveBeenCalledWith('ro', 'factory')
    expect(svc.forwarders).toHaveBeenCalledWith('fa')
    expect(svc.customers).toHaveBeenCalledWith('co')
    expect(svc.consignees).toHaveBeenCalledWith('ac')
  })
})

describe('UiAlertRulesController', () => {
  it('delegates GET /alert-rules to the service', async () => {
    const svc = fakeSvc()
    await new UiAlertRulesController(svc as any).get()
    expect(svc.alertRules).toHaveBeenCalledOnce()
  })

  it('governs GET /alert-rules with @PageRead(alert_rules)', () => {
    expect(new Reflector().get<string>(PAGE_READ_KEY, UiAlertRulesController.prototype.get)).toBe('alert_rules')
  })

  // Write guard: saving alert SLAs now requires Edit on the 'alert_rules' page (Access Control matrix),
  // replacing the static @Roles('ADMIN'). Locks in the fix for the demo-era hole where the guard was off.
  it('governs PUT /alert-rules with @PageWrite(alert_rules) and leaves no residual @Roles', () => {
    expect(new Reflector().get<string>(PAGE_WRITE_KEY, UiAlertRulesController.prototype.save)).toBe('alert_rules')
    expect(new Reflector().get(ROLES_KEY, UiAlertRulesController.prototype.save)).toBeUndefined()
  })

  // The two POST /alert-rules/reset cases went with the route. Guard its ABSENCE instead: a
  // governed write endpoint nothing calls is surface without a user, and this controller is the
  // only place it could come back.
  it('exposes no reset route', () => {
    expect((UiAlertRulesController.prototype as unknown as Record<string, unknown>).reset).toBeUndefined()
  })
})

describe('UiShipmentHistoryController', () => {
  it('delegates GET /shipments/:id/history to the service', async () => {
    const svc = fakeSvc()
    await new UiShipmentHistoryController(svc as any).history('leg-1')
    expect(svc.shipmentHistory).toHaveBeenCalledWith('leg-1')
  })
})
