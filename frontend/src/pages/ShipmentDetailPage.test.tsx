import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CriticReview } from '../lib/critic-review'
import type { ShipmentDetail } from '../hooks/use-shipments'
import ShipmentDetailPage from './ShipmentDetailPage'

// Data + mutation seams are mocked; DetailRow / FieldHistoryPopover / ContestedLockCard render for
// real, so this exercises the actual Order Details grid the highlight lands on.
const { mockUseShipment } = vi.hoisted(() => ({ mockUseShipment: vi.fn() }))

vi.mock('../hooks/use-shipments', () => ({
  useShipment: mockUseShipment,
  useUpdateShipment: () => ({ mutate: vi.fn(), isPending: false }),
  useResolveContestedLock: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../hooks/use-shipment-history', () => ({
  useShipmentHistory: () => ({ data: undefined }),
}))
// Renders unconditionally and carries its own data hooks — not what this test is about.
vi.mock('../components/shipments/PurchaseOrdersCard', () => ({
  PurchaseOrdersCard: () => null,
}))
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
