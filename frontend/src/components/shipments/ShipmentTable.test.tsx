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
    // Real-shaped uuid: the pinned column derives its ID from the anchor month (firstEmailAt ?? createdAt,
    // here 2026-02) + this head → 2026025393 (#348/#350)
    id: '5393954C-8CED-4329-BAC6-2868EE704C76',
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
    firstEmailAt: null,
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
  it('does not render a separate SO No column (SO lives on the detail page)', () => {
    renderTable([baseShipment({ soNumber: 'SO-SHOULD-NOT-SHOW' })])
    expect(screen.queryByRole('columnheader', { name: /so no/i })).not.toBeInTheDocument()
    expect(screen.queryByText('SO-SHOULD-NOT-SHOW')).not.toBeInTheDocument()
    expect(screen.getByText('2026025393')).toBeInTheDocument()
  })

  it('anchors the Shipment ID month to the beginning email, falling back to creation (#348/#350)', () => {
    renderTable([
      // beginning email Apr 2026 wins over the May createdAt
      baseShipment({ id: 'AAAA1111-0000-4000-8000-000000000001', firstEmailAt: '2026-04-18T10:00:00.000Z', createdAt: '2026-05-02T00:00:00.000Z' }),
      // keyless shell, no emails: still a real identity — creation-month fallback, not —
      baseShipment({ id: 'BBBB2222-0000-4000-8000-000000000002', createdAt: '2026-07-24T00:00:00.000Z', bookingNo: null, soNumber: null, hblNumber: null }),
    ])
    expect(screen.getByText('202604AAAA')).toBeInTheDocument()
    expect(screen.getByText('202607BBBB')).toBeInTheDocument()
    // booking/SO/HBL are search + detail-page data now, never the pinned cell text
    expect(screen.queryByText('BY058417')).not.toBeInTheDocument()
  })

  // JSDOM applies no CSS, so these assert the class contract; real rendering is measured in-browser.
  it('pins the Shipment ID column for horizontal scroll (sticky left, opaque bg)', () => {
    renderTable([baseShipment()])

    const th = screen.getByRole('columnheader', { name: /shipment id/i })
    expect(th).toHaveClass('sticky', 'left-0', 'bg-surface-850')

    const td = screen.getByText('2026025393').closest('td')!
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
    for (const name of [/shipment id/i, /^route$/i, /^status$/i]) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveClass('hidden')
    }

    // body cells hide in lockstep with their headers (0-indexed: 3 = Forwarder at md, rest at lg)
    const bodyRow = screen.getByText('2026025393').closest('tr')!
    const cells = within(bodyRow).getAllByRole('cell')
    expect(cells[3]).toHaveClass('hidden', 'md:table-cell')
    for (const i of [1, 2, 6, 7, 8, 9]) expect(cells[i]).toHaveClass('hidden', 'lg:table-cell')
  })

  it('tiers the table min-width so a narrow viewport fits the visible columns', () => {
    renderTable([baseShipment()])
    const table = screen.getByRole('table')
    // No base min-width: three columns fit any phone, so forcing one would invent a scrollbar.
    expect(table).not.toHaveClass('min-w-[560px]')
    // lg shows all ten columns. 1000px could not seat them: every column was squeezed under its
    // content, so Shipment ID and the Status badge clipped and the text cells broke tokens mid-word
    // to cope ("CNYTN→NL / RTM"). 1240px is what the columns actually need; below it the container
    // scrolls with Shipment ID pinned, which is what the sticky column is for.
    expect(table).toHaveClass('md:min-w-[600px]', 'lg:min-w-[1240px]')
  })

  // The pinned column's rule marks content sliding UNDER it. With nothing scrolled it is just a
  // stray vertical line mid-table, which is exactly how it read on a non-overflowing screen.
  it('draws no pinned divider until the table is scrolled sideways', () => {
    renderTable([baseShipment()])
    const divider = 'shadow-[inset_-1px_0_0_var(--color-border)]'
    expect(screen.getByRole('columnheader', { name: /shipment id/i })).not.toHaveClass(divider)
    expect(screen.getByText('2026025393').closest('td')!).not.toHaveClass(divider)
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

/**
 * The tracker's job is telling rows apart, and truncation was defeating it: nine consecutive rows
 * read "Logimark Internation…", four read "WYSE LONDON LI…", and the Status column clipped its
 * longest label to "Booking Reque" — a cut word reads as a broken chip, not a shortened one.
 */
describe('ShipmentTable — the row must be readable, not just tidy (2026-07-28)', () => {
  it('shows the customer CODE, with the full name on hover', () => {
    renderTable([baseShipment()])
    const cell = screen.getByTestId('customer-code')
    expect(cell).toHaveTextContent('COLE')
    expect(cell.closest('td')).toHaveAttribute('title', 'Cole Haan')
  })

  it('falls back to the raw twin, then the name, when no master resolved', () => {
    renderTable([baseShipment({ customer: null, customerRaw: 'UNKNOWN SENDER' } as Partial<Shipment>)])
    expect(screen.getByTestId('customer-code')).toHaveTextContent('UNKNOWN SENDER')
  })

  /**
   * "CNYTN→NLRTM" is one token to the browser, so a narrow column broke it wherever it ran out —
   * "CNYTN→NL / RTM". A port code split across lines is not a shorter label, it is a different
   * string the operator has to reassemble. The <wbr> is the only legal break point.
   */
  it('lets a route break at the arrow and nowhere else', () => {
    renderTable([baseShipment({ route: 'CNYTN→GBFXT' })])
    const cell = screen.getByText(/CNYTN/).closest('td')!
    expect(cell).toHaveAttribute('title', 'CNYTN→GBFXT')
    expect(cell.querySelectorAll('wbr')).toHaveLength(1)
    // both codes survive intact either side of the break opportunity
    expect(cell.textContent).toBe('CNYTN→GBFXT')
  })

  it('leaves a route with no arrow alone', () => {
    renderTable([baseShipment({ route: 'CNYTN' })])
    expect(screen.getByText('CNYTN').closest('td')!.querySelectorAll('wbr')).toHaveLength(0)
  })

  it('clamps a long value to two lines rather than pushing the row taller', () => {
    renderTable([baseShipment({ forwarderId: 'f1', forwarder: { id: 'f1', name: 'Logimark International Limited Guangzhou Branch' } } as Partial<Shipment>)])
    const span = screen.getByText('Logimark International Limited Guangzhou Branch')
    expect(span).toHaveClass('line-clamp-2')
    expect(span.closest('td')).toHaveAttribute('title', 'Logimark International Limited Guangzhou Branch')
  })

  it('holds every row to one height, so a wrapped cell cannot break the rhythm', () => {
    renderTable([baseShipment(), baseShipment({ id: 'CCCC3333-0000-4000-8000-000000000003' })])
    for (const row of screen.getAllByRole('row').slice(1)) {
      expect(row).toHaveClass('h-[68px]')
    }
  })

  it('keeps the PO chip on one line — "0 POs" wrapped into a tall oval beside the "1 PO" rows', () => {
    renderTable([baseShipment({ linkedPOs: [] })])
    expect(screen.getByTestId('customer-po-chip')).toHaveClass('whitespace-nowrap')
  })
})
