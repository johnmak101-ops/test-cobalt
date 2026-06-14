import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ShipmentTrackerPage from './ShipmentTrackerPage'
import { useShipments } from '../hooks/use-shipments'
import type { Shipment } from '../hooks/use-shipments'

vi.mock('../hooks/use-shipments', () => ({ useShipments: vi.fn() }))

const ship = (id: string, customer: string, bookingNo: string): Shipment => ({
  id,
  bookingId: 'b-' + id,
  bookingNo,
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
  customer: { id: 'c', name: customer, code: 'C' },
  forwarder: { id: 'f', name: 'Torque' },
  linkedPOs: [],
})

const renderPage = (shipments: Shipment[]) => {
  ;(useShipments as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: { shipments }, isLoading: false })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ShipmentTrackerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ShipmentTrackerPage', () => {
  it('lists shipments and shows the pagination summary', () => {
    renderPage([ship('1', 'New Lobster', 'BK-1'), ship('2', 'SKIM US West', 'BK-2')])
    expect(screen.getByText('New Lobster')).toBeInTheDocument()
    expect(screen.getByText('SKIM US West')).toBeInTheDocument()
    expect(screen.getByText(/Showing 1.2 of 2/)).toBeInTheDocument()
  })

  it('filters the table by the search box', async () => {
    renderPage([ship('1', 'New Lobster', 'BK-1'), ship('2', 'SKIM US West', 'BK-2')])
    await userEvent.type(screen.getByPlaceholderText(/Search by PO/), 'lobster')
    expect(screen.getByText('New Lobster')).toBeInTheDocument()
    expect(screen.queryByText('SKIM US West')).not.toBeInTheDocument()
    expect(screen.getByText(/Showing 1.1 of 1/)).toBeInTheDocument()
  })
})
