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
  it('renders each numeric field as the numeric field, not type=number', () => {
    renderModal()
    for (const label of ['Total Quantity', 'Gross Weight']) {
      expect(inputFor(label)).toHaveAttribute('type', 'text')
    }
    // qty is a physical count — the keypad has no decimal point; gross weight is a measure.
    expect(inputFor('Total Quantity')).toHaveAttribute('inputmode', 'numeric')
    expect(inputFor('Gross Weight')).toHaveAttribute('inputmode', 'decimal')
  })

  it('leaves text fields alone', () => {
    renderModal()
    expect(inputFor('Booking No.')).not.toHaveAttribute('type', 'number')
    expect(inputFor('Container No.')).not.toHaveAttribute('type', 'number')
  })

  it('holds the range warning until the field is left', async () => {
    const user = userEvent.setup()
    renderModal()
    // A minus sign never even reaches the value now — it is not a digit.
    await user.type(inputFor('Total Quantity'), '0')
    expect(screen.queryByTestId('number-field-error')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByTestId('number-field-error')).toHaveTextContent(/whole number greater than 0/)
  })
})
