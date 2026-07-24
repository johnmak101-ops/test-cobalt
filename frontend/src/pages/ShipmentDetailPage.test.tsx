import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CriticReview } from '../lib/critic-review'
import type { ShipmentDetail } from '../hooks/use-shipments'
import ShipmentDetailPage from './ShipmentDetailPage'

// Data + mutation seams are mocked; DetailRow / FieldHistoryPopover / ContestedLockCard render for
// real, so this exercises the actual Order Details grid the highlight lands on.
const { mockUseShipment, mutateSpy } = vi.hoisted(() => ({
  mockUseShipment: vi.fn(),
  mutateSpy: vi.fn(),
}))

vi.mock('../hooks/use-shipments', () => ({
  useShipment: mockUseShipment,
  useUpdateShipment: () => ({ mutate: mutateSpy, isPending: false }),
  useResolveContestedLock: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/use-shipment-history', () => ({
  useShipmentHistory: () => ({ data: undefined }),
}))
// Renders unconditionally and carries its own data hooks — not what this test is about.
vi.mock('../components/shipments/PurchaseOrdersCard', () => ({
  PurchaseOrdersCard: () => null,
}))
// PortPicker mounts in edit mode; without this its query would hit the real backend from jsdom.
vi.mock('../hooks/use-ports', () => ({ usePorts: () => ({ data: [] }) }))
vi.mock('../components/ui/Toast', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function criticWithConflicts(fields: string[]): CriticReview {
  return {
    confidence: { score: 0.4, band: 'low', label: 'Low confidence' },
    summary: 'conflicts',
    observations: [],
    priorState: { headline: '', fields: [] },
    proposedChanges: [],
    riskFlags: [],
    conflicts: fields.map((field) => ({
      field,
      label: field,
      candidates: [{ value: 'a', source: 'System' }],
      rationale: 'test',
    })),
    recommendedHumanAction: 'review',
    reasons: [],
  }
}

function fixture(over: Partial<ShipmentDetail> = {}): ShipmentDetail {
  return {
    id: 'ship-1',
    bookingNo: 'GZL26261147',
    soNumber: null,
    customer: { id: 'c1', name: 'Wyse London', code: 'WYSE' },
    vendor: { id: 'v1', name: 'Macau Fung Tai', code: 'MACFUN' },
    forwarder: { id: 'f1', name: 'LOGIMARK' },
    route: 'CAN→LHR',
    status: 'BOOKED',
    mode: 'AIR',
    quantityShipped: 16,
    quantityUnit: 'cartons',
    etd: '2026-02-08T00:00:00.000Z',
    eta: '2026-02-11T00:00:00.000Z',
    linkedPOs: [],
    milestones: [],
    emails: [],
    alerts: [],
    updatedAt: '2026-07-20T12:00:00.000Z',
    ...over,
  } as unknown as ShipmentDetail
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/shipments/ship-1']}>
        <Routes>
          <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          <Route path="/shipments" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const pendingMarks = () => [...document.querySelectorAll('mark.review-pending-value')]

describe('ShipmentDetailPage — pending-review word highlight', () => {
  beforeEach(() => {
    mockUseShipment.mockReset()
    mutateSpy.mockClear()
  })

  it('masks provisional conflicted fields to the prior System value, amber-marked — and only those', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'provisional',
        criticReview: criticWithConflicts(['etd', 'qty_unit']),
      }),
      isLoading: false,
    })
    renderPage()

    // Unconfirmed-answer mask (2026-07-24): the committed-but-undecided value must NOT display —
    // the row shows the pre-write System candidate ('a') in amber instead.
    const marks = pendingMarks()
    expect(marks).toHaveLength(2)
    expect(marks.every((m) => m.textContent === 'a')).toBe(true)
    expect(screen.queryByText('cartons')).toBeNull()

    // Booking No. has no conflict — its value must stay unmarked (and unmasked).
    for (const el of screen.getAllByText('GZL26261147')) {
      expect(el.closest('mark')).toBeNull()
    }
  })

  it('shows a yellow icon (hover = the message) for review questions, red for master misses', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'provisional',
        criticReview: {
          ...criticWithConflicts(['etd']),
          masterMisses: [{ type: 'vendor', rawName: 'SOUOCE', field: 'vendor_code' }],
        },
      }),
      isLoading: false,
    })
    renderPage()

    const warn = screen.getAllByTestId('pending-icon-warn')
    expect(warn.length).toBeGreaterThan(0)
    expect(warn[0]).toHaveAttribute('title', 'test — please verify.')
    const miss = screen.getByTestId('pending-icon-miss')
    expect(miss).toHaveAttribute('title', '"SOUOCE" not found in Mesh Database — advise add in Mesh.')
    // the vendor code value itself takes the amber colour, no wash
    expect(pendingMarks().some((m) => m.textContent === 'MACFUN')).toBe(true)
  })

  it('masks the Customer/Vendor Code rows when a party conflict is pending (raw-twin mapping)', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'provisional',
        criticReview: criticWithConflicts(['vendor_code', 'customer']),
      }),
      isLoading: false,
    })
    renderPage()

    // Masked to the prior System candidate — the undecided master codes must not display.
    const texts = pendingMarks().map((m) => m.textContent ?? '')
    expect(texts).toEqual(['a', 'a'])
    expect(screen.queryByText('MACFUN')).toBeNull()
    expect(screen.queryByText('WYSE')).toBeNull()
  })

  it('shows no marks once the review is confirmed', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'confirmed',
        criticReview: criticWithConflicts(['etd', 'qty_unit']),
      }),
      isLoading: false,
    })
    renderPage()
    expect(pendingMarks()).toHaveLength(0)
  })

  it('marks contested-lock fields even when the review is confirmed', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'confirmed',
        contestedLocks: [{ field: 'etd', yourValue: '2026-02-07', newValue: '2026-02-08' }],
      }),
      isLoading: false,
    })
    renderPage()

    const marks = pendingMarks()
    expect(marks).toHaveLength(1)
    expect(marks[0]!.textContent).toContain('Feb 2026')
  })

  it('never marks a blank value — a conflict with no prior shows a plain "(pending)"', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        etd: null,
        reviewStatus: 'provisional',
        criticReview: {
          ...criticWithConflicts([]),
          // No System candidate — the LLM proposed onto an empty field. The row must show the
          // "(pending)" placeholder (unmarked), never the undecided proposal.
          conflicts: [
            {
              field: 'etd',
              label: 'etd',
              candidates: [{ value: '2026-02-09', source: 'SO' }],
              rationale: 'test',
            },
          ],
        },
      }),
      isLoading: false,
    })
    renderPage()
    expect(pendingMarks()).toHaveLength(0)
    expect(screen.getAllByText(/\(pending\)/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/2026-02-09/)).toBeNull()
  })
})

/** First-column texts (labels) of every row in the titled Order Details section, in DOM order. */
function sectionLabels(title: string): string[] {
  const section = screen.getByText(title).closest('div')!.parentElement!
  return [...section.querySelectorAll('div.grid > :first-child')].map(
    (el) => el.textContent?.trim() ?? '',
  )
}

describe('ShipmentDetailPage — read view and edit form stay in step', () => {
  beforeEach(() => {
    mockUseShipment.mockReset()
    mutateSpy.mockClear()
  })

  it('lists Key Dates rows in the same order in both modes', async () => {
    mockUseShipment.mockReturnValue({ data: fixture(), isLoading: false })
    const user = userEvent.setup()
    renderPage()

    const readOrder = sectionLabels('Key Dates')
    expect(readOrder).toHaveLength(9)
    await user.click(screen.getByRole('button', { name: /edit/i }))
    expect(sectionLabels('Key Dates')).toEqual(readOrder)
  })

  it('lists shared Shipping rows in the same relative order in both modes', async () => {
    mockUseShipment.mockReturnValue({ data: fixture(), isLoading: false })
    const user = userEvent.setup()
    renderPage()

    const readOrder = sectionLabels('Shipping')
    await user.click(screen.getByRole('button', { name: /edit/i }))
    const editOrder = sectionLabels('Shipping')
    // Each mode has legitimate extras (read: Route / Origin Country; edit: Customer / Vendor raw) —
    // the fields present in BOTH must not reshuffle.
    expect(editOrder.filter((l) => readOrder.includes(l))).toEqual(
      readOrder.filter((l) => editOrder.includes(l)),
    )
  })

  it('shows a timed cut-off as date + time inputs, prefilled', async () => {
    mockUseShipment.mockReturnValue({
      // Local wall-clock string on purpose (no Z): the inputs are local time.
      data: fixture({ warehouseEndDate: '2026-03-02T18:00:00' }),
      isLoading: false,
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const date = screen.getByLabelText('WH End Date') as HTMLInputElement
    const time = screen.getByLabelText('WH End Date time') as HTMLInputElement
    expect(date).toHaveAttribute('type', 'date')
    expect(time).toHaveAttribute('type', 'time')
    expect(date.value).toBe('2026-03-02')
    expect(time.value).toBe('18:00')
  })

  it('saves a day picked into a PREVIOUSLY EMPTY date field — no time required', async () => {
    // datetime-local regression: an incomplete date+time reported "" and the edit silently vanished.
    mockUseShipment.mockReturnValue({
      data: fixture({ actualArrival: null }),
      isLoading: false,
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    fireEvent.change(screen.getByLabelText('ATA'), { target: { value: '2026-02-25' } })
    await user.type(screen.getByLabelText(/note for the agent/i), 'ata from carrier portal')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    expect(mutateSpy.mock.calls[0]![0]).toMatchObject({
      fields: { ata: '2026-02-25T00:00' },
    })
  })

  it('exposes Warehouse SO as its own edit field beside SO#', async () => {
    mockUseShipment.mockReturnValue({
      data: fixture({ soNumber: 'FEL-GZ-OSA-2842', warehouseSo: 'B1261611448' }),
      isLoading: false,
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    expect((screen.getByLabelText('SO#') as HTMLInputElement).value).toBe('FEL-GZ-OSA-2842')
    expect((screen.getByLabelText('Warehouse SO') as HTMLInputElement).value).toBe('B1261611448')
  })

  it('splits SO# and Warehouse SO into separate READ rows too — no combined "A · B" row', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({ soNumber: 'FEL-GZ-OSA-2842', warehouseSo: 'B1261611448' }),
      isLoading: false,
    })
    renderPage()

    expect(sectionLabels('Order Info')).toEqual(
      expect.arrayContaining(['SO#', 'Warehouse SO']),
    )
    // Scoped to the rows — the page TITLE legitimately keeps its compact joined "A · B" summary.
    const section = screen.getByText('Order Info').closest('div')!.parentElement!
    const rowValue = (label: string) => {
      const row = [...section.querySelectorAll('div.grid')].find(
        (r) => r.firstElementChild?.textContent?.trim() === label,
      )!
      return row.children[1]!.textContent?.trim()
    }
    expect(rowValue('SO#')).toBe('FEL-GZ-OSA-2842')
    expect(rowValue('Warehouse SO')).toBe('B1261611448')
  })

  it('offers only SEA / AIR modes, with the current granular mode selectable and NOT "unrecognized"', async () => {
    mockUseShipment.mockReturnValue({ data: fixture({ mode: 'SEA_LCL' }), isLoading: false })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const select = screen.getByTestId('edit-select-mode') as HTMLSelectElement
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toEqual(['—', 'SEA_LCL', 'SEA', 'AIR'])
  })

  it('keeps the stored cut-off time when only the day is changed', async () => {
    mockUseShipment.mockReturnValue({
      data: fixture({ warehouseEndDate: '2026-03-02T18:00:00' }),
      isLoading: false,
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    fireEvent.change(screen.getByLabelText('WH End Date'), { target: { value: '2026-03-05' } })
    await user.type(screen.getByLabelText(/note for the agent/i), 'CFS moved by forwarder')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    expect(mutateSpy.mock.calls[0]![0]).toMatchObject({
      fields: { warehouseEndDate: '2026-03-05T18:00' },
    })
  })
})

describe('ShipmentDetailPage — header identity', () => {
  beforeEach(() => {
    mockUseShipment.mockReset()
  })

  it('shows ONLY the Shipment ID in the title — booking/SO stay in Order Details', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({ soNumber: 'SO-123', warehouseSo: '098-32230564' }),
      isLoading: false,
    })
    renderPage()
    const h1 = document.querySelector('h1')!
    expect(h1.textContent).toContain('Shipment ID')
    expect(h1.textContent).not.toContain('Booking No.')
    expect(h1.textContent).not.toContain('SO')
    // The identifiers are not lost — Booking No. still renders in the Order Details rows.
    expect(screen.getAllByText('GZL26261147').length).toBeGreaterThan(0)
  })
})
