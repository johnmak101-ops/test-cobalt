import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  it('does not render a separate SO No column (SO may still appear as Booking ID fallback)', () => {
    renderTable([baseShipment({ soNumber: 'SO-SHOULD-NOT-SHOW' })])
    expect(screen.queryByRole('columnheader', { name: /so no/i })).not.toBeInTheDocument()
    // bookingNo present → SO not used as Booking ID label
    expect(screen.queryByText('SO-SHOULD-NOT-SHOW')).not.toBeInTheDocument()
    expect(screen.getByText('BY058417')).toBeInTheDocument()
  })

  it('Booking ID falls through bookingNo → soNumber → hblNumber (parse-identity D1)', () => {
    renderTable([
      baseShipment({ id: 'a', bookingNo: null, soNumber: 'S2600144827', hblNumber: 'SNZ260004243' }),
      baseShipment({ id: 'b', bookingNo: null, soNumber: null, hblNumber: 'SZA26050003' }),
      baseShipment({ id: 'c', bookingNo: null, soNumber: null, hblNumber: null }),
    ])
    expect(screen.getByText('S2600144827')).toBeInTheDocument()
    expect(screen.getByText('SZA26050003')).toBeInTheDocument()
    // pure keyless shell still —
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  // JSDOM applies no CSS, so these assert the class contract; real rendering is measured in-browser.
  it('pins the Booking ID column for horizontal scroll (sticky left, opaque bg)', () => {
    renderTable([baseShipment()])

    const th = screen.getByRole('columnheader', { name: /booking id/i })
    expect(th).toHaveClass('sticky', 'left-0', 'bg-surface-850')

    const td = screen.getByText('BY058417').closest('td')!
    expect(td).toHaveClass('sticky', 'left-0', 'bg-surface-800', 'group-hover:bg-surface-700')
    // the pinned cell mirrors row hover via the row being a Tailwind group
    expect(td.closest('tr')!).toHaveClass('group')
  })

  it('drops low-priority columns on narrow screens, keeping the identity ones', () => {
    renderTable([baseShipment()])

    // lg tier: everything a narrow screen can live without — the shipment detail page has them all.
    for (const name of [/customer po#/i, /^customer$/i, /^etd$/i, /^eta$/i, /^last activity$/i, /^risk$/i]) {
      expect(screen.getByRole('columnheader', { name })).toHaveClass('hidden', 'lg:table-cell')
    }
    expect(screen.getByRole('columnheader', { name: /^forwarder$/i })).toHaveClass('hidden', 'md:table-cell')

    // What survives at every width: which shipment, where it is going, where it has got to.
    for (const name of [/booking id/i, /^route$/i, /^status$/i]) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveClass('hidden')
    }

    // body cells hide in lockstep with their headers (0-indexed: 3 = Forwarder at md, rest at lg)
    const bodyRow = screen.getByText('BY058417').closest('tr')!
    const cells = within(bodyRow).getAllByRole('cell')
    expect(cells[3]).toHaveClass('hidden', 'md:table-cell')
    for (const i of [1, 2, 6, 7, 8, 9]) expect(cells[i]).toHaveClass('hidden', 'lg:table-cell')
  })

  it('tiers the table min-width so a narrow viewport fits the visible columns', () => {
    renderTable([baseShipment()])
    const table = screen.getByRole('table')
    // No base min-width: three columns fit any phone, so forcing one would invent a scrollbar.
    expect(table).not.toHaveClass('min-w-[560px]')
    expect(table).toHaveClass('md:min-w-[600px]', 'lg:min-w-[1000px]')
  })

  // The pinned column's rule marks content sliding UNDER it. With nothing scrolled it is just a
  // stray vertical line mid-table, which is exactly how it read on a non-overflowing screen.
  it('draws no pinned divider until the table is scrolled sideways', () => {
    renderTable([baseShipment()])
    const divider = 'shadow-[inset_-1px_0_0_var(--color-border)]'
    expect(screen.getByRole('columnheader', { name: /booking id/i })).not.toHaveClass(divider)
    expect(screen.getByText('BY058417').closest('td')!).not.toHaveClass(divider)
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
