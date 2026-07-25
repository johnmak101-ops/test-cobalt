import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewShipmentModal } from './NewShipmentModal'

vi.mock('../../hooks/use-shipments', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/use-shipments')>(
    '../../hooks/use-shipments',
  )
  return { ...actual, useCreateShipment: () => ({ mutate: vi.fn(), isPending: false }) }
})

function renderModal() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <NewShipmentModal onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const inputFor = (label: string) => screen.getByText(label).closest('label')!.querySelector('input')!

describe('NewShipmentModal numeric fields — derived from isNumericColumn, not hand-listed', () => {
  it('renders each numeric field as a restricted number input', () => {
    renderModal()
    for (const label of ['Total Quantity', 'Gross Weight']) {
      const input = inputFor(label)
      expect(input).toHaveAttribute('type', 'number')
      expect(input).toHaveAttribute('min', '0')
    }
    // qty is a physical count — whole numbers only; gross weight is a measure, so fractions are legal.
    expect(inputFor('Total Quantity')).toHaveAttribute('step', '1')
    expect(inputFor('Gross Weight')).toHaveAttribute('step', 'any')
  })

  it('leaves text fields alone', () => {
    renderModal()
    expect(inputFor('Booking No.')).not.toHaveAttribute('type', 'number')
    expect(inputFor('Container No.')).not.toHaveAttribute('type', 'number')
  })

  it('shows the range warning on a bad count', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(inputFor('Total Quantity'), '-5')
    expect(screen.getByTestId('create-err-qty')).toHaveTextContent(/cannot be negative/)
  })
})
