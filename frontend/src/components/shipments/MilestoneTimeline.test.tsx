import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  MilestoneTimeline,
  orientationLine,
  stageDateCaption,
} from './MilestoneTimeline'
import { formatDate } from '../../lib/utils'

describe('stageDateCaption', () => {
  it('formats actual date when present', () => {
    const raw = '2026-07-17T00:00:00Z'
    expect(
      stageDateCaption({ date: raw, est: null, done: true, type: 'BOOKING_SENT' }),
    ).toBe(formatDate(raw))
  })

  it('returns Done when done with no date (done beats est)', () => {
    expect(
      stageDateCaption({
        date: null,
        est: '2026-07-26T00:00:00Z',
        done: true,
        type: 'DEPARTED',
      }),
    ).toBe('Done')
  })

  it('returns Not yet when pending with no estimate', () => {
    expect(
      stageDateCaption({ date: null, est: null, done: false, type: 'DRAFT_BL_RECEIVED' }),
    ).toBe('Not yet')
  })

  it('returns ETD line for pending Departure with etd', () => {
    const etd = '2026-07-26T00:00:00Z'
    expect(
      stageDateCaption({ date: null, est: etd, done: false, type: 'DEPARTED' }),
    ).toBe(`ETD ${formatDate(etd)}`)
  })

  it('returns ETA line for pending ARRIVED with eta', () => {
    const eta = '2026-08-01T00:00:00Z'
    expect(
      stageDateCaption({ date: null, est: eta, done: false, type: 'ARRIVED' }),
    ).toBe(`ETA ${formatDate(eta)}`)
  })
})

describe('orientationLine', () => {
  it('mid-lifecycle: Now and Next', () => {
    const line = orientationLine([
      { label: 'Booking Request', done: true, isCurrent: false, isNext: false, isLast: false },
      { label: 'SO Received', done: true, isCurrent: true, isNext: false, isLast: false },
      { label: 'Draft BOL', done: false, isCurrent: false, isNext: true, isLast: false },
      { label: 'Delivered', done: false, isCurrent: false, isNext: false, isLast: true },
    ])
    expect(line).toBe('Now: SO Received · Next: Draft BOL')
  })

  it('terminal complete', () => {
    const line = orientationLine([
      { label: 'Booking Request', done: true, isCurrent: false, isNext: false, isLast: false },
      { label: 'Delivered', done: true, isCurrent: false, isNext: false, isLast: true },
    ])
    expect(line).toBe('Complete · Delivered')
  })

  it('not started', () => {
    const line = orientationLine([
      { label: 'Booking Request', done: false, isCurrent: false, isNext: false, isLast: false },
      { label: 'Delivered', done: false, isCurrent: false, isNext: false, isLast: true },
    ])
    expect(line).toBe('Not started · Next: Booking Request')
  })
})

describe('MilestoneTimeline', () => {
  it('shows lean stages: Booking Request → SO → Draft BOL → Final BOL → Departure → Delivered', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
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
  // Eng lock: caption is Done, never Est./ETD when done.
  it('a SAILED leg with no ATD shows Departure as Done, not an estimate', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-01-01T00:00:00Z', notes: null },
        ]}
        currentStatus="SAILED"
        etd="2026-01-05T00:00:00Z"
        atd={null}
      />,
    )
    expect(screen.queryByText(/Est\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/^ETD /)).not.toBeInTheDocument()
    // Departure row is done without date → one of the "Done" captions
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0)
  })

  it('tolerates stored AT_WAREHOUSE milestones without crashing or showing them', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
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

  it('shows orientation Now/Next for mid-lifecycle CONFIRMED with SO date', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-07-17T00:00:00Z', notes: null },
          { id: '2', milestoneType: 'SO_RECEIVED', occurredAt: '2026-07-18T00:00:00Z', notes: null },
        ]}
        currentStatus="CONFIRMED"
      />,
    )
    expect(screen.getByTestId('milestone-orientation')).toHaveTextContent(
      'Now: SO Received · Next: Draft BOL',
    )
  })

  it('shows Not yet for future stages without estimates', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-07-17T00:00:00Z', notes: null },
        ]}
        currentStatus="BOOKED"
      />,
    )
    expect(screen.getAllByText('Not yet').length).toBeGreaterThan(0)
    expect(screen.queryByText('Awaiting')).not.toBeInTheDocument()
  })

  it('shows ETD when Departure is pending with etd (not status-sailed)', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-07-01T00:00:00Z', notes: null },
          { id: '2', milestoneType: 'FINAL_BL_RECEIVED', occurredAt: '2026-07-10T00:00:00Z', notes: null },
        ]}
        currentStatus="CONFIRMED"
        etd="2026-07-26T00:00:00Z"
        atd={null}
      />,
    )
    // currentIndex from FINAL_BL = 3; Departure (4) not done → ETD line
    expect(screen.getByText(`ETD ${formatDate('2026-07-26T00:00:00Z')}`)).toBeInTheDocument()
  })

  it('shows Complete orientation when delivered with inDcDate', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-01-01T00:00:00Z', notes: null },
        ]}
        currentStatus="ARRIVED"
        inDcDate="2026-02-01T00:00:00Z"
      />,
    )
    expect(screen.getByTestId('milestone-orientation')).toHaveTextContent(/Complete · Delivered/)
  })
})
