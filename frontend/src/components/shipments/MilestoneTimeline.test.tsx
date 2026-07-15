import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MilestoneTimeline } from './MilestoneTimeline'

describe('MilestoneTimeline', () => {
  it('shows lean stages: Booking Request → SO → Draft BOL → Final BOL → Departure → Delivered', () => {
    render(
      <MilestoneTimeline
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-01-01T00:00:00Z', notes: null },
          { id: '2', milestoneType: 'SO_RECEIVED', occurredAt: '2026-01-02T00:00:00Z', notes: null },
        ]}
        currentStatus="CONFIRMED"
      />,
    )
    expect(screen.getByText('Booking Request')).toBeInTheDocument()
    expect(screen.getByText('SO Received')).toBeInTheDocument()
    expect(screen.getByText('Draft BOL')).toBeInTheDocument()
    expect(screen.getByText('Final BOL')).toBeInTheDocument()
    expect(screen.getByText('Departure')).toBeInTheDocument()
    expect(screen.getByText('Delivered')).toBeInTheDocument()
    expect(screen.queryByText('At Warehouse')).not.toBeInTheDocument()
    expect(screen.queryByText('Arrived')).not.toBeInTheDocument()
  })

  // The STATE_TO_INDEX floor exists for legs whose stage has no date. state.ts BUG-7 bumps a leg to
  // SAILED with NO atd (Invoice/Billing + carrier doc + past ETD — "demonstrably sailed"). Such a leg
  // must still show Departure as reached; mapping SAILED below Departure made it advertise an
  // ESTIMATED departure for a ship that already left.
  it('a SAILED leg with no ATD shows Departure as reached, not an estimate', () => {
    render(
      <MilestoneTimeline
        milestones={[{ id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-01-01T00:00:00Z', notes: null }]}
        currentStatus="SAILED"
        etd="2026-01-05T00:00:00Z"
        atd={null}
      />,
    )
    // Departure is implied-complete → em dash, never "Est."
    expect(screen.queryByText(/Est\./)).not.toBeInTheDocument()
  })

  it('tolerates stored AT_WAREHOUSE milestones without crashing or showing them', () => {
    render(
      <MilestoneTimeline
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-01-01T00:00:00Z', notes: null },
          { id: 'w', milestoneType: 'AT_WAREHOUSE', occurredAt: '2026-01-03T00:00:00Z', notes: null },
          { id: '2', milestoneType: 'DRAFT_BL_RECEIVED', occurredAt: '2026-01-04T00:00:00Z', notes: null },
        ]}
        currentStatus="AT_WAREHOUSE"
        warehouseStartDate="2026-01-03T00:00:00Z"
      />,
    )
    expect(screen.getByText('Booking Request')).toBeInTheDocument()
    expect(screen.getByText('Draft BOL')).toBeInTheDocument()
    expect(screen.queryByText('At Warehouse')).not.toBeInTheDocument()
  })
})
