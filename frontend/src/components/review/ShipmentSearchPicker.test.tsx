import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShipmentSearchPicker } from './ShipmentSearchPicker'
import type { ShipmentSearchHit } from '../../hooks/use-shipment-search'

const hitSelf: ShipmentSearchHit = {
  id: 'ship-1',
  bookingNo: 'SELF-001',
  soNumber: null,
  customerName: 'Current Co',
  route: 'CNYTN→GBFXT',
  status: 'BOOKED',
  reviewStatus: 'needs_review',
}

const hitOther: ShipmentSearchHit = {
  id: 'ship-2',
  bookingNo: 'SSL-318-2026',
  soNumber: 'SO-99',
  customerName: 'Cole Haan',
  route: 'VNSGN→USLAX',
  status: 'BOOKED',
  reviewStatus: null,
}

const mockUseShipmentSearch = vi.fn()

vi.mock('../../hooks/use-shipment-search', () => ({
  useShipmentSearch: (q: string) => mockUseShipmentSearch(q),
}))

describe('ShipmentSearchPicker', () => {
  beforeEach(() => {
    mockUseShipmentSearch.mockReset()
    mockUseShipmentSearch.mockImplementation((q: string) => {
      const trimmed = q.trim()
      if (trimmed.length < 2) {
        return { data: undefined, isFetching: false }
      }
      return {
        data: { shipments: [hitSelf, hitOther] },
        isFetching: false,
      }
    })
  })

  it('lists results and selects a shipment', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ShipmentSearchPicker excludeId="ship-1" onSelect={onSelect} onCancel={vi.fn()} />,
    )

    await user.type(screen.getByRole('searchbox'), 'SSL')

    const option = await screen.findByRole('button', { name: /SSL-318/i })
    // Current shipment is filtered client-side
    expect(screen.queryByRole('button', { name: /SELF-001/i })).not.toBeInTheDocument()

    await user.click(option)
    expect(onSelect).toHaveBeenCalledWith(
      'ship-2',
      expect.objectContaining({ bookingNo: 'SSL-318-2026' }),
    )
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <ShipmentSearchPicker excludeId="ship-1" onSelect={vi.fn()} onCancel={onCancel} />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('shows a short-query hint until 2+ characters are typed', () => {
    mockUseShipmentSearch.mockReturnValue({ data: undefined, isFetching: false })
    render(
      <ShipmentSearchPicker excludeId="ship-1" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText(/type at least 2 characters/i)).toBeInTheDocument()
  })

  it('shows loading state while fetching', async () => {
    const user = userEvent.setup()
    mockUseShipmentSearch.mockImplementation((q: string) => {
      if (q.trim().length < 2) return { data: undefined, isFetching: false }
      return { data: undefined, isFetching: true }
    })
    render(
      <ShipmentSearchPicker excludeId="ship-1" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    await user.type(screen.getByRole('searchbox'), 'SSL')
    await waitFor(() => {
      expect(screen.getByText(/searching/i)).toBeInTheDocument()
    })
  })

  it('shows empty state when no matches remain after exclude', async () => {
    const user = userEvent.setup()
    mockUseShipmentSearch.mockImplementation((q: string) => {
      if (q.trim().length < 2) return { data: undefined, isFetching: false }
      return { data: { shipments: [hitSelf] }, isFetching: false }
    })
    render(
      <ShipmentSearchPicker excludeId="ship-1" onSelect={vi.fn()} onCancel={vi.fn()} />,
    )
    await user.type(screen.getByRole('searchbox'), 'SELF')
    await waitFor(() => {
      expect(screen.getByText(/no shipments match/i)).toBeInTheDocument()
    })
  })
})
