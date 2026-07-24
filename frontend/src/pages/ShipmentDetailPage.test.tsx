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

const pendingMarks = () =>
  screen.queryAllByTitle('Pending review').filter((el) => el.tagName === 'MARK')

describe('ShipmentDetailPage — pending-review word highlight', () => {
  beforeEach(() => {
    mockUseShipment.mockReset()
    mutateSpy.mockClear()
  })

  it('marks the values of fields named in provisional critic conflicts, and only those', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'provisional',
        criticReview: criticWithConflicts(['etd', 'qty_unit']),
      }),
      isLoading: false,
    })
    renderPage()

    const marks = pendingMarks()
    const texts = marks.map((m) => m.textContent ?? '')
    expect(texts.some((t) => t.includes('cartons'))).toBe(true)
    expect(texts.some((t) => t.includes('Feb 2026'))).toBe(true)
    expect(marks).toHaveLength(2)
    expect(marks.every((m) => m.classList.contains('review-pending-value'))).toBe(true)

    // Booking No. has no conflict — its value (header + row) must stay unmarked.
    for (const el of screen.getAllByText('GZL26261147')) {
      expect(el.closest('mark')).toBeNull()
    }
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

  it('never marks a blank value — "(pending)" placeholders stay plain', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        etd: null,
        reviewStatus: 'provisional',
        criticReview: criticWithConflicts(['etd']),
      }),
      isLoading: false,
    })
    renderPage()
    expect(pendingMarks()).toHaveLength(0)
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
