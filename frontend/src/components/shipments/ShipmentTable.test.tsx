import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ShipmentTable } from './ShipmentTable'
import type { Shipment } from '../../hooks/use-shipments'

const ship = (over: Partial<Shipment> = {}): Shipment => ({
  id: 's1',
  bookingId: 'b1',
  bookingNo: 'BK-1',
  soNumber: null,
  hblNumber: null,
  containerNo: null,
  mblNumber: null,
  mode: 'SEA',
  status: 'CONFIRMED',
  riskLevel: 'ON_TRACK',
  reviewStatus: 'confirmed',
  confidence: null,
  route: 'CN→GB',
  etd: '2026-02-10',
  eta: '2026-03-01',
  updatedAt: new Date().toISOString(),
  customer: { id: 'c1', name: 'New Lobster', code: 'NEWLOB' },
  forwarder: { id: 'f1', name: 'Torque' },
  linkedPOs: [{ id: 'po1', poNumber: 'PO-1', quantity: null, totalQuantity: 100, quantityUnit: 'pieces', vendor: { name: 'Roknit' } }],
  ...over,
})

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('ShipmentTable', () => {
  it('renders a row with id, customer, forwarder, status label and PO count', () => {
    wrap(<ShipmentTable shipments={[ship()]} />)
    expect(screen.getByText('BK-1')).toBeInTheDocument()
    expect(screen.getByText('New Lobster')).toBeInTheDocument()
    expect(screen.getByText('Torque')).toBeInTheDocument()
    expect(screen.getByText('Confirmed')).toBeInTheDocument() // CONFIRMED → label
    expect(screen.getByText('1 PO')).toBeInTheDocument()
  })

  it('expands to reveal a PO child row', async () => {
    wrap(<ShipmentTable shipments={[ship()]} />)
    const before = screen.getAllByRole('row').length // header + parent
    await userEvent.click(screen.getAllByRole('button')[0]!) // the expand chevron
    expect(screen.getAllByRole('row').length).toBe(before + 1)
  })

  it('shows a risk indicator for delayed shipments', () => {
    const { container } = wrap(<ShipmentTable shipments={[ship({ riskLevel: 'DELAYED' })]} />)
    expect(container.querySelector('.text-status-critical')).toBeTruthy()
  })

  it('renders an empty state', () => {
    wrap(<ShipmentTable shipments={[]} />)
    expect(screen.getByText('No shipments found')).toBeInTheDocument()
  })
})
