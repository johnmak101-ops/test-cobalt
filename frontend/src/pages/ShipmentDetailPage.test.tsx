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

  it('shows the STORED value on a conflicted row, amber-marked — and only those rows', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        reviewStatus: 'provisional',
        criticReview: criticWithConflicts(['etd', 'qty_unit']),
      }),
      isLoading: false,
    })
    renderPage()

    /**
     * The mask is gone (2026-07-27). It replaced the stored value with the critic's `System`
     * candidate ('a'), which made Order Details disagree with the review card's
     * "Current (on shipment)" for the same field. The row now prints what the leg holds; the amber
     * mark and the warning icon are what say it is unresolved.
     */
    const marks = pendingMarks()
    expect(marks).toHaveLength(2)
    expect(marks.some((m) => m.textContent === 'cartons')).toBe(true)
    expect(marks.every((m) => m.textContent === 'a')).toBe(false)

    // Booking No. has no conflict — its value stays unmarked.
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

    // Hovering an icon opens the change-history-style card with the message(s) — the native
    // title tooltip is gone (ops 2026-07-24: one hover-card design across the page).
    const warn = screen.getAllByTestId('pending-icon-warn')
    expect(warn.length).toBeGreaterThan(0)
    fireEvent.mouseEnter(warn[0])
    expect(screen.getByTestId('pending-annotation-popover')).toHaveTextContent('test — please verify.')
    expect(screen.getByTestId('pending-annotation-popover')).toHaveTextContent('Needs Review')
    fireEvent.mouseLeave(warn[0])

    const miss = screen.getByTestId('pending-icon-miss')
    fireEvent.mouseEnter(miss)
    const cards = screen.getAllByTestId('pending-annotation-popover')
    expect(
      cards.some((c) =>
        (c.textContent ?? '').includes('"SOUOCE" has no near match in database.'),
      ),
    ).toBe(true)
    expect(cards.some((c) => (c.textContent ?? '').includes('Master Miss'))).toBe(true)
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

    // The party codes the leg actually holds, amber-marked — the same values the review card prints
    // as "Current (on shipment)". Leg 202601DD8E used to read ROKNFT there and "(pending)" here.
    const texts = pendingMarks().map((m) => m.textContent ?? '')
    expect(texts).toEqual(['WYSE', 'MACFUN'])
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

  it('an empty date keeps the page-wide TBD placeholder, and the icon carries the question', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({
        etd: null,
        reviewStatus: 'provisional',
        criticReview: {
          ...criticWithConflicts([]),
          // No System candidate — the LLM proposed onto an empty field. The row shows the leg's own
          // (empty) state, never the undecided proposal.
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
    // Nothing stored → nothing to mark, and the proposal stays in the review queue.
    expect(pendingMarks()).toHaveLength(0)
    expect(screen.queryByText(/2026-02-09/)).toBeNull()
    // 'TBD' is what every other empty date row on this page shows (ATA, In DC Date) — the mask used
    // to force this one to "(pending)" instead, which was inconsistent with its own neighbours.
    const etdRow = [...document.querySelectorAll('div.grid')].find((d) =>
      d.textContent?.startsWith('ETD'),
    )
    expect(etdRow?.textContent).toContain('TBD')
    // The open question is still announced — by the icon, not by hiding the field.
    expect(screen.getAllByTestId('pending-icon-warn').length).toBeGreaterThan(0)
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

  it('offers only SEA / AIR modes', async () => {
    mockUseShipment.mockReturnValue({ data: fixture({ mode: 'SEA' }), isLoading: false })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const select = screen.getByTestId('edit-select-mode') as HTMLSelectElement
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toEqual(['—', 'SEA', 'AIR'])
  })

  /**
   * FCL/LCL was retired end-to-end (migration 0023 rewrote every row and narrowed the DB CHECK), so a
   * granular value is no longer part of the vocabulary. If one ever reappears — a restored pre-migration
   * backup, a hand-written API call — it must read as unrecognized rather than be quietly offered as
   * valid, which is what would let it re-enter the data and re-split legs.
   */
  it('marks a resurrected granular mode as unrecognized', async () => {
    mockUseShipment.mockReturnValue({ data: fixture({ mode: 'SEA_LCL' }), isLoading: false })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const select = screen.getByTestId('edit-select-mode') as HTMLSelectElement
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toEqual(['—', 'SEA_LCL (unrecognized)', 'SEA', 'AIR'])
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

/**
 * Piece 2 of the mode-change design. A mode change is a reclassification: it invalidates one set of
 * transport fields and requires another. Nothing on this form used to say so, so a leg switched
 * AIR→SEA kept its flight number for good — hidden by the old mode-only visibility rule, and
 * unreachable from every other screen.
 */
describe('ShipmentDetailPage — switching mode states what it strands', () => {
  beforeEach(() => {
    mockUseShipment.mockReset()
    mutateSpy.mockClear()
  })

  const airLegWithAirFields = () =>
    fixture({ mode: 'AIR', flightNo: 'CX252', mawb: '160-88112233' } as Partial<ShipmentDetail>)

  const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
    mockUseShipment.mockReturnValue({ data: airLegWithAirFields(), isLoading: false, isError: false })
    renderPage()
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
  }

  it('says nothing while the mode is unchanged', async () => {
    const user = userEvent.setup()
    await openEditor(user)
    expect(screen.queryByTestId('mode-carry-over')).toBeNull()
  })

  it('lists the stranded fields the moment the mode changes, ticked to clear', async () => {
    const user = userEvent.setup()
    await openEditor(user)
    await user.selectOptions(screen.getByLabelText('Mode'), 'SEA')

    const panel = screen.getByTestId('mode-carry-over')
    expect(panel).toHaveTextContent(/Switching\s*AIR\s*→\s*SEA/)
    expect(panel).toHaveTextContent(/2 stored fields belong to the old mode/i)
    expect(screen.getByTestId('mode-carry-over-flightNo')).toBeChecked()
    expect(screen.getByTestId('mode-carry-over-mawb')).toBeChecked()
    // The values stay on screen — nothing vanishes from under the operator before they save.
    expect(panel).toHaveTextContent('CX252')
  })

  it('saves the mode and the clears as one act', async () => {
    const user = userEvent.setup()
    await openEditor(user)
    await user.selectOptions(screen.getByLabelText('Mode'), 'SEA')
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'booking moved to ocean')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(mutateSpy).toHaveBeenCalledTimes(1)
    expect(mutateSpy.mock.calls[0][0].fields).toMatchObject({
      mode: 'SEA',
      flightNo: null,
      mawb: null,
    })
  })

  it('un-ticking keeps that field across the switch', async () => {
    const user = userEvent.setup()
    await openEditor(user)
    await user.selectOptions(screen.getByLabelText('Mode'), 'SEA')
    await user.click(screen.getByTestId('mode-carry-over-mawb'))
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'keep the MAWB for the claim')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    const sent = mutateSpy.mock.calls[0][0].fields
    expect(sent).toMatchObject({ mode: 'SEA', flightNo: null })
    expect(sent).not.toHaveProperty('mawb')
  })

  it('changing the mode back withdraws the whole consequence', async () => {
    const user = userEvent.setup()
    await openEditor(user)
    await user.selectOptions(screen.getByLabelText('Mode'), 'SEA')
    expect(screen.getByTestId('mode-carry-over')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Mode'), 'AIR')
    expect(screen.queryByTestId('mode-carry-over')).toBeNull()
  })
})
