import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FieldHistoryPopover } from './FieldHistoryPopover'
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

describe('FieldHistoryPopover', () => {
  it('renders the value plain (no marker) when the field has no history', () => {
    render(
      <FieldHistoryPopover label="Total Quantity" entries={[]}>
        350
      </FieldHistoryPopover>,
    )
    expect(screen.getByText('350')).toBeInTheDocument()
    expect(screen.queryByTestId('field-history-anchor')).toBeNull()
  })

  it('marks a changed field and opens its own field timeline on hover', async () => {
    const user = userEvent.setup()
    render(
      <FieldHistoryPopover
        label="Total Quantity"
        entries={[entry('qty', { oldValue: '300', newValue: '350', sourceType: 'manual' })]}
      >
        350
      </FieldHistoryPopover>,
    )
    const anchor = screen.getByTestId('field-history-anchor')
    expect(anchor).toBeInTheDocument()
    expect(screen.queryByTestId('field-history-popover')).toBeNull()

    await user.hover(anchor)

    const popover = await screen.findByTestId('field-history-popover')
    expect(popover.textContent).toContain('Total Quantity — change history')
    expect(popover.textContent).toContain('300')
    expect(popover.textContent).toContain('350')
    expect(popover.textContent).toContain('Manual edit')
    // portaled to body so the card's overflow cannot clip it
    expect(popover.parentElement).toBe(document.body)
  })
})
