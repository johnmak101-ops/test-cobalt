import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CriticConflict, CriticReview } from '../lib/critic-review'
import type { ShipmentDetail } from '../hooks/use-shipments'
import ShipmentReviewFocusPage from './ShipmentReviewFocusPage'

// Only the data + mutation seams are mocked — ReviewCard renders for real, so this exercises the
// actual conflict table / action bar the focused page is meant to surface.
const { mockUseShipment, mutateAsync } = vi.hoisted(() => ({
  mockUseShipment: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../hooks/use-shipments', () => ({ useShipment: mockUseShipment }))
vi.mock('../hooks/use-review-queue', () => ({
  useConfirmShipment: () => ({ mutateAsync }),
  useCorrectShipment: () => ({ mutateAsync }),
  useIdentifyShipment: () => ({ mutateAsync }),
  useLinkShipment: () => ({ mutateAsync }),
  isStaleConflict: () => false,
}))
vi.mock('../components/ui/Toast', () => ({ toast: vi.fn() }))

const conflictEta: CriticConflict = {
  field: 'eta',
  label: 'ETA',
  candidates: [
    { value: '2026-07-20', source: 'System' },
    { value: '2026-07-23', source: 'SO' },
  ],
  rationale: 'Newer SO supersedes stored ETA.',
}

const criticReview: CriticReview = {
  confidence: { score: 0.32, band: 'low', label: 'Low confidence' },
  summary: 'ETA mismatch',
  observations: [],
  priorState: { headline: '', fields: [] },
  proposedChanges: [],
  riskFlags: [{ code: 'MULTI_ID', severity: 'low', message: 'Two strong IDs in one email' }],
  conflicts: [conflictEta],
  recommendedHumanAction: 'Resolve then confirm',
  reasons: ['conflicting_identifiers'],
}

function fixture(over: Partial<ShipmentDetail> = {}): ShipmentDetail {
  return {
    id: 'ship-1',
    bookingNo: 'BY058417',
    soNumber: null,
    customer: { id: 'c1', name: 'Cole Haan', code: 'COLE' },
    forwarder: { id: 'f1', name: 'SEH' },
    route: 'CNYTN→GBFXT',
    status: 'BOOKED',
    reviewStatus: 'provisional',
    updatedAt: '2026-07-10T12:00:00.000Z',
    firstEmailAt: '2026-01-16T03:00:00.000Z',
    createdAt: '2026-07-10T12:00:00.000Z',
    criticReview,
    emails: [],
    ...over,
  } as unknown as ShipmentDetail
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/review-queue/ship-1']}>
        <Routes>
          <Route path="/review-queue/:id" element={<ShipmentReviewFocusPage />} />
          <Route path="/review-queue" element={<div>queue-landing</div>} />
          <Route path="/shipments/:sid" element={<div>shipment-detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ShipmentReviewFocusPage', () => {
  beforeEach(() => {
    mockUseShipment.mockReset()
    mutateAsync.mockClear()
  })

  it('shows a loading state while the shipment loads', () => {
    mockUseShipment.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderPage()
    expect(screen.getByText(/loading review/i)).toBeInTheDocument()
  })

  it('renders the focused review card with the conflict table and an approve action', () => {
    mockUseShipment.mockReturnValue({ data: fixture(), isLoading: false, isError: false })
    renderPage()

    // Title leads with the derived Shipment ID, same identity the detail page shows (#350/#355) —
    // anchored to the beginning email (2026-01), not to createdAt (2026-07).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review 202601SHIP')
    // The booking is not lost, it moves to the subtitle.
    expect(screen.getByText(/BY058417/)).toBeInTheDocument()
    // Opened directly (single history entry) → falls back to the queue.
    expect(screen.getByRole('button', { name: /back to review queue/i })).toBeInTheDocument()

    // The conflict comparison table (from the reused ReviewCard) is present and expanded.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('ETA')).toBeInTheDocument()

    // And the approve action is live (not read-only).
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.queryByText(/shown read-only/i)).not.toBeInTheDocument()
  })

  it('Back returns to the previous page (not the queue) when reached from elsewhere', async () => {
    mockUseShipment.mockReturnValue({ data: fixture(), isLoading: false, isError: false })
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/shipments/ship-1', '/review-queue/ship-1']} initialIndex={1}>
          <Routes>
            <Route path="/review-queue/:id" element={<ShipmentReviewFocusPage />} />
            <Route path="/review-queue" element={<div>queue-landing</div>} />
            <Route path="/shipments/:sid" element={<div>shipment-detail</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // reached from the shipment detail → the control is "Back" and pops history to there, not the queue
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('shipment-detail')).toBeInTheDocument()
    expect(screen.queryByText('queue-landing')).not.toBeInTheDocument()
  })

  it('renders read-only with no approve action when the shipment is no longer provisional', () => {
    mockUseShipment.mockReturnValue({
      data: fixture({ reviewStatus: 'confirmed' }),
      isLoading: false,
      isError: false,
    })
    renderPage()

    expect(screen.getByText(/shown read-only/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('shows a not-loaded message on error', () => {
    mockUseShipment.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderPage()
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
  })
})
