import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CategorizedShipmentHistory } from './CategorizedShipmentHistory'
import type { HistoryEntry } from '../../hooks/use-shipment-history'

function entry(field: string, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `${field}-${over.newValue ?? '1'}`,
    shipmentId: 's1',
    field,
    oldValue: null,
    newValue: 'x',
    sourceType: 'manual',
    sourceId: null,
    changedBy: null,
    isDelay: false,
    notes: null,
    changedAt: '2026-07-18T00:00:00.000Z',
    ...over,
  }
}

describe('CategorizedShipmentHistory', () => {
  it('groups into category sections with counts, omitting empty categories', () => {
    render(
      <CategorizedShipmentHistory
        history={[entry('qty', { newValue: '350' }), entry('grossWeight'), entry('status')]}
      />,
    )
    expect(screen.getByRole('button', { name: /Cargo & Logistics/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /Status & Lifecycle/ })).toHaveTextContent('1')
    // Order Info has no entries → its header is not rendered
    expect(screen.queryByRole('button', { name: /Order Info/ })).toBeNull()
  })

  it('is collapsed by default and expands a category to reveal its timeline entries', async () => {
    const user = userEvent.setup()
    render(<CategorizedShipmentHistory history={[entry('qty', { oldValue: '300', newValue: '350' })]} />)
    // collapsed: the entry's value is not in the DOM yet
    expect(screen.queryByText('350')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Cargo & Logistics/ }))
    expect(screen.getByText('Total Quantity')).toBeInTheDocument() // field label from the timeline
    expect(screen.getByText('350')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
  })

  it('shows an empty state when there is no history', () => {
    render(<CategorizedShipmentHistory history={[]} />)
    expect(screen.getByText(/No changes recorded yet/)).toBeInTheDocument()
  })
})
