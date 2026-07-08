import { describe, it, expect, vi } from 'vitest'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../auth/decorators'
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

  // Write guard: saving alert SLAs must stay ADMIN-or-higher (rank-based guard).
  // Locks in the fix for the demo-era hole where the guard was commented out.
  it('restricts PUT /alert-rules to ADMIN or higher', () => {
    const roles = new Reflector().get<string[]>(ROLES_KEY, UiAlertRulesController.prototype.save)
    expect(roles).toEqual(['ADMIN'])
  })
})

describe('UiShipmentHistoryController', () => {
  it('delegates GET /shipments/:id/history to the service', async () => {
    const svc = fakeSvc()
    await new UiShipmentHistoryController(svc as any).history('leg-1')
    expect(svc.shipmentHistory).toHaveBeenCalledWith('leg-1')
  })
})
