import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ShipmentTable } from './ShipmentTable'
import type { Shipment } from '../../hooks/use-shipments'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

function baseShipment(over: Partial<Shipment> = {}): Shipment {
  return {
    id: 'leg-1',
    poNumbers: '["10261406"]',
    customerId: 'c1',
    vendorId: null,
    forwarderId: null,
    mode: 'SEA',
    route: 'CNYTN→GBFXT',
    originCountry: 'CN',
    status: 'SAILED',
    riskLevel: 'ON_TRACK',
    bookingNo: 'BY058417',
    soNumber: null,
    itemStyleNo: null,
    consigneeName: null,
    consigneeAddress: null,
    containerNo: null,
    mblNumber: null,
    scacCode: null,
    crd: null,
    cfsCutoff: null,
    etd: null,
    eta: null,
    actualDeparture: null,
    actualArrival: null,
    warehouseStartDate: null,
    warehouseEndDate: null,
    inDcDate: null,
    hblNumber: null,
    vesselName: null,
    voyageNumber: null,
    warehouseAddress: null,
    quantityShipped: null,
    quantityUnit: null,
    grossWeight: null,
    measurement: null,
    htsCode: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-10T00:00:00.000Z',
    customer: { id: 'c1', name: 'Cole Haan', code: 'COLE' },
    linkedPOs: [
      {
        id: 'po-1',
        poNumber: '10261406',
        quantity: 100,
        totalQuantity: 500,
        quantityUnit: 'cartons',
        vendor: { id: 'v1', name: 'Rose Knit', code: 'ROK' },
      },
    ],
    ...over,
  }
}

function renderTable(shipments: Shipment[]) {
  return render(
    <MemoryRouter>
      {/* Mirror the page overflow that clipped the absolute popover (#118). */}
      <div className="overflow-hidden">
        <div className="overflow-x-auto" style={{ width: 320 }}>
          <ShipmentTable shipments={shipments} />
        </div>
      </div>
    </MemoryRouter>,
  )
}

describe('ShipmentTable — Customer PO popover (#118)', () => {
  it('portals the full PO list to document.body so table overflow cannot clip it', async () => {
    const user = userEvent.setup()
    renderTable([baseShipment()])

    expect(screen.queryByTestId('customer-po-popover')).toBeNull()

    await user.hover(screen.getByTestId('customer-po-chip'))

    const panel = await screen.findByTestId('customer-po-popover')
    expect(panel).toBeInTheDocument()
    expect(panel.textContent).toContain('10261406')
    expect(panel.textContent).toContain('Customer Purchase Orders')
    // Portaled outside the overflow wrapper — parent is document.body
    expect(panel.parentElement).toBe(document.body)
    expect(panel.style.position).toBe('fixed')
  })

  it('shows every PO when the chip is multi-PO', async () => {
    const user = userEvent.setup()
    renderTable([
      baseShipment({
        linkedPOs: [
          { id: 'po-1', poNumber: 'AAA-1', quantity: 1, totalQuantity: 1, quantityUnit: 'ctn', vendor: null },
          { id: 'po-2', poNumber: 'BBB-2', quantity: 2, totalQuantity: 2, quantityUnit: 'ctn', vendor: null },
        ],
      }),
    ])

    await user.hover(screen.getByTestId('customer-po-chip'))
    const panel = await screen.findByTestId('customer-po-popover')
    expect(panel.textContent).toContain('AAA-1')
    expect(panel.textContent).toContain('BBB-2')
    expect(screen.getByTestId('customer-po-chip').textContent).toMatch(/2 POs/)
  })
})

describe('ShipmentTable — column layout (#119)', () => {
  it('does not render an SO No column', () => {
    renderTable([baseShipment({ soNumber: 'SO-SHOULD-NOT-SHOW' })])
    expect(screen.queryByRole('columnheader', { name: /so no/i })).not.toBeInTheDocument()
    expect(screen.queryByText('SO-SHOULD-NOT-SHOW')).not.toBeInTheDocument()
  })

  it('puts the provisional awaiting-review icon in Risk, not next to Status', () => {
    renderTable([
      baseShipment({
        reviewStatus: 'provisional',
        riskLevel: 'ON_TRACK',
        status: 'BOOKED',
      }),
    ])
    const icon = screen.getByTestId('risk-awaiting-review')
    expect(icon).toHaveAttribute('title', 'Awaiting review')
    // Status column still shows the badge label only
    expect(screen.getByText(/booking request/i)).toBeInTheDocument()
  })
})
