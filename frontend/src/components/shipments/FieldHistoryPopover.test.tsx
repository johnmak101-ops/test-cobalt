import { describe, it, expect, vi } from 'vitest'
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

  it('offers the source email, opening the same reading pane the timeline uses', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(
      <FieldHistoryPopover
        label="Booking No."
        entries={[
          entry('booking_no', {
            oldValue: null,
            newValue: 'GZOSA2600021',
            sourceType: 'email',
            sourceId: 'msg-42',
            notes: 'FW: Booking confirmation GZOSA2600021',
          }),
        ]}
      >
        GZOSA2600021
      </FieldHistoryPopover>,
    )
    await user.hover(screen.getByTestId('field-history-anchor'))
    await screen.findByTestId('field-history-popover')

    const link = screen.getByTestId('field-history-email-link')
    // the timestamp IS the link; the subject rides along in the tooltip
    expect(link.textContent).toMatch(/\d/)
    expect(link).toHaveAttribute(
      'title',
      'Open the source email — FW: Booking confirmation GZOSA2600021',
    )
    // no separate subject row eating a line of a w-72 popover
    expect(screen.getByTestId('field-history-popover').textContent).not.toContain(
      'FW: Booking confirmation',
    )

    await user.click(link)
    expect(open).toHaveBeenCalledWith(
      '/email/msg-42?type=',
      'email_msg-42',
      expect.stringContaining('popup'),
    )
    open.mockRestore()
  })

  it('still links when the entry carries no subject — the tooltip just drops it', async () => {
    const user = userEvent.setup()
    render(
      <FieldHistoryPopover
        label="ETD"
        entries={[entry('etd', { sourceType: 'email', sourceId: 'msg-7', notes: null })]}
      >
        17 Feb 2026
      </FieldHistoryPopover>,
    )
    await user.hover(screen.getByTestId('field-history-anchor'))
    await screen.findByTestId('field-history-popover')
    const link = screen.getByTestId('field-history-email-link')
    expect(link).toHaveAttribute('title', 'Open the source email')
    expect(link.textContent).toMatch(/\d/)
  })

  it('links a Review queue change to that shipment’s review view', async () => {
    const user = userEvent.setup()
    render(
      <FieldHistoryPopover
        label="ETA"
        entries={[entry('eta', { sourceType: 'review', sourceId: null })]}
      >
        17 Feb 2026
      </FieldHistoryPopover>,
    )
    await user.hover(screen.getByTestId('field-history-anchor'))
    const popover = await screen.findByTestId('field-history-popover')
    expect(popover.textContent).toContain('Review queue')
    expect(screen.getByTestId('field-history-review-link')).toHaveAttribute(
      'href',
      '/review-queue/s1',
    )
  })

  it('leaves the date as plain text when there is no email to open', async () => {
    const user = userEvent.setup()
    render(
      <FieldHistoryPopover
        label="ETD"
        entries={[entry('etd', { sourceType: 'manual', sourceId: null, newValue: 'a' })]}
      >
        17 Feb 2026
      </FieldHistoryPopover>,
    )
    await user.hover(screen.getByTestId('field-history-anchor'))
    const popover = await screen.findByTestId('field-history-popover')
    expect(screen.queryByTestId('field-history-email-link')).toBeNull()
    // the timestamp is still shown, just not clickable
    expect(popover.textContent).toMatch(/Manual edit ·\s*\S+/)
  })

  it('shows no email link for manual or system changes, or when the source id is missing', async () => {
    const user = userEvent.setup()
    render(
      <FieldHistoryPopover
        label="ETD"
        entries={[
          entry('etd', { sourceType: 'manual', sourceId: 'msg-1', newValue: 'a' }),
          entry('etd', { sourceType: 'system', sourceId: 'msg-2', newValue: 'b' }),
          entry('etd', { sourceType: 'email', sourceId: null, newValue: 'c' }),
        ]}
      >
        17 Feb 2026
      </FieldHistoryPopover>,
    )
    await user.hover(screen.getByTestId('field-history-anchor'))
    await screen.findByTestId('field-history-popover')
    expect(screen.queryByTestId('field-history-email-link')).toBeNull()
  })
})
