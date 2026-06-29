import { describe, it, expect, vi } from 'vitest'
import { ShipmentsController } from './shipments.controller'

const make = () => {
  const shipments = {
    lookupByMatchKey: vi.fn().mockReturnValue('matcher-result'),
    listForTracker: vi.fn(),
    getOne: vi.fn(),
  }
  const ui = {
    shipments: vi.fn().mockResolvedValue('ui-list'),
    shipment: vi.fn().mockResolvedValue('ui-detail'),
  }
  return { shipments, ui, c: new ShipmentsController(shipments as any, ui as any) }
}

describe('ShipmentsController.index — matcher vs UI list', () => {
  it('routes a match-key query to the agent matcher (unchanged)', () => {
    const { shipments, ui, c } = make()
    const out = c.index({ booking_no: 'BK1' })
    expect(shipments.lookupByMatchKey).toHaveBeenCalledWith({ booking_no: 'BK1' })
    expect(ui.shipments).not.toHaveBeenCalled()
    expect(out).toBe('matcher-result')
  })

  it('routes a plain query to the UI presentation list with filters', () => {
    const { shipments, ui, c } = make()
    c.index({ status: 'SAILED', customerId: 'c1', forwarderId: 'f1' })
    expect(shipments.lookupByMatchKey).not.toHaveBeenCalled()
    expect(ui.shipments).toHaveBeenCalledWith({ status: 'SAILED', customerId: 'c1', forwarderId: 'f1' })
  })

  it('does not treat customerId/forwarderId as match keys', () => {
    const { shipments, ui, c } = make()
    c.index({ customerId: 'c1' })
    expect(shipments.lookupByMatchKey).not.toHaveBeenCalled()
    expect(ui.shipments).toHaveBeenCalled()
  })
})

describe('ShipmentsController.getOne — UI detail', () => {
  it('delegates to the presentation service', () => {
    const { ui, c } = make()
    c.getOne('leg-1')
    expect(ui.shipment).toHaveBeenCalledWith('leg-1')
  })
})
