import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MilestoneTimeline, stageDateCaption } from './MilestoneTimeline'
import { statusLabels } from '../ui/Badge'
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

describe('MilestoneTimeline', () => {
  /**
   * The status badge and the timeline render the SAME shipment status, so they must agree on which
   * stage it names. STATE_TO_INDEX drifted from Badge.tsx after #126 re-added Draft BOL and Final
   * BOL as stages: AT_WAREHOUSE floored one stage short, and SAILED floored a stage too far — a leg
   * whose badge read "Final BOL" had Departure ticked as done, claiming a shipment had sailed when
   * only its B/L had been cut.
   *
   * Asserted against Badge.tsx's own statusLabels, not a copy of them, so relabelling a status
   * there without moving its index here fails loudly.
   */
  it.each([
    ['CONFIRMED', 'SO Received', 'Draft BOL'],
    ['AT_WAREHOUSE', 'Draft BOL', 'Final BOL'],
    ['SAILED', 'Final BOL', 'Departure'],
    ['DEPARTED', 'Departure', 'Delivered'],
  ])('%s makes %s current and leaves %s untouched — matching its badge', (status, current, next) => {
    render(<MilestoneTimeline horizontal={false} milestones={[]} currentStatus={status} />)
    expect(statusLabels[status]).toBe(current)
    expect(screen.getByText(current)).toHaveClass('font-semibold', 'text-status-warning')
    expect(screen.getByText(next)).toHaveClass('font-medium', 'text-text-primary')
  })

  it('ARRIVED completes the terminal stage rather than marking it in-progress', () => {
    render(<MilestoneTimeline horizontal={false} milestones={[]} currentStatus="ARRIVED" />)
    expect(statusLabels.ARRIVED).toBe('Delivered')
    expect(screen.getByText('Delivered')).toHaveClass('text-text-secondary')
    expect(screen.getByText('Delivered')).not.toHaveClass('text-status-warning')
  })

  // The "Now: X · Next: Y" strip and its orientationLine helper are gone — the stepper already
  // shows both: current = the amber node with the moving transport icon, next = the empty ring
  // beside it. Guarded so the sentence cannot creep back above the stages.
  it('renders no orientation strip above the stepper', () => {
    render(<MilestoneTimeline horizontal milestones={[]} currentStatus="CONFIRMED" />)
    expect(screen.queryByTestId('milestone-orientation')).toBeNull()
    expect(screen.queryByText(/^Now: /)).toBeNull()
    expect(screen.queryByText(/^Complete · /)).toBeNull()
  })

  // The horizontal connectors used to be flex siblings with `self-center`, which centred them on the
  // whole stage column — icon AND label AND date — so they drew ~31px too low, straight through the
  // label row, and were squeezed to whatever width the text left over (~9px). They are now absolute,
  // pinned to the icons' centre line. All offsets in rem, because the app's font-scale toggle moves
  // the root size and a px offset would drift off-centre the moment a user scales the text.
  it('draws the connectors on the icon centre line, out of the label flow', () => {
    const { container } = render(
      <MilestoneTimeline horizontal milestones={[]} currentStatus="BOOKED" />,
    )
    const rules = [...container.querySelectorAll('div')].filter((d) => d.className.includes('h-0.5'))
    expect(rules).toHaveLength(5) // six stages, five gaps
    for (const rule of rules) {
      expect(rule).toHaveClass('absolute', 'top-[0.8125rem]')
      expect(rule.className).not.toContain('self-center')
      expect(rule.className).not.toContain('flex-1')
    }
  })

  // A `horizontal` prop on the caller forced six stages side by side however narrow the card was.
  // The layout is chosen from the component's OWN container width — the viewport is the wrong
  // yardstick when a sidebar and page padding sit between it and this card.
  it('picks its layout from container width when horizontal is not forced', () => {
    const { container } = render(
      <MilestoneTimeline milestones={[]} currentStatus="BOOKED" />,
    )
    const root = container.querySelector('[data-testid="milestone-timeline"]')!
    expect(root).toHaveClass('@container')
    expect(root.querySelector('.\\@2xl\\:hidden')).not.toBeNull()
    expect(root.querySelector('.hidden.\\@2xl\\:block')).not.toBeNull()
  })

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

  /**
   * The eng lock this replaces: a leg that has demonstrably departed but carries no ATD must show
   * Departure as **Done**, never as an ETD estimate. That guarantee is kept — but it was being
   * tested through the wrong status.
   *
   * The old test drove it with currentStatus="SAILED", on the premise that "state.ts BUG-7 bumps a
   * leg to SAILED with NO atd". It does not: BUG-7 (Invoice/Billing + carrier doc + past ETD) bumps
   * to RELEASED, which stateToUiStatus translates to DEPARTED — state.spec.ts asserts that three
   * times. So the BUG-7 leg reaches Departure on its own, and propping SAILED up to index 4 to
   * carry it only mislabelled every genuine Final-BOL leg as departed.
   *
   * The trap is the name: DB state SAILED reads like "has sailed" but is the Final BOL DOCUMENT
   * stage — paperwork cut, goods not necessarily moved.
   */
  it('a departed leg with no ATD shows Departure as Done, not an estimate', () => {
    render(
      <MilestoneTimeline
        horizontal={false}
        milestones={[
          { id: '1', milestoneType: 'BOOKING_SENT', occurredAt: '2026-01-01T00:00:00Z', notes: null },
        ]}
        currentStatus="DEPARTED" // what BUG-7's RELEASED actually arrives as
        etd="2026-01-05T00:00:00Z"
        atd={null}
      />,
    )
    expect(screen.queryByText(/Est\./)).not.toBeInTheDocument()
    expect(screen.queryByText(/^ETD /)).not.toBeInTheDocument()
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0)
  })

  // The other half: paperwork alone must NOT claim the goods moved. A Final BOL leg still owes an
  // ETD on Departure — that estimate is correct here, and was being suppressed.
  it('a Final BOL leg with no ATD leaves Departure pending, still showing its ETD', () => {
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
    expect(screen.getByText('Final BOL')).toHaveClass('text-status-warning')
    expect(screen.getByText(`ETD ${formatDate('2026-01-05T00:00:00Z')}`)).toBeInTheDocument()
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

  // Was an assertion on the "Now: X · Next: Y" strip. That strip is gone, but which stage is
  // CURRENT and which is NEXT is still the point of the component — the stepper now carries it,
  // so assert it there: current is amber and bold, next is plain primary, the rest recede.
  it('marks the current and next stage for mid-lifecycle CONFIRMED with SO date', () => {
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
    expect(screen.getByText('SO Received')).toHaveClass('font-semibold', 'text-status-warning')
    expect(screen.getByText('Draft BOL')).toHaveClass('font-medium', 'text-text-primary')
    expect(screen.getByText('Booking Request')).toHaveClass('text-text-secondary')
    expect(screen.getByText('Delivered')).toHaveClass('text-text-muted')
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

  // Was the "Complete · Delivered" strip. Same guarantee, read off the stepper: the terminal stage
  // is done and dated from inDcDate, and nothing is left mid-flight (no amber current stage).
  it('shows the terminal stage complete and dated when delivered with inDcDate', () => {
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
    expect(screen.getByText('Delivered')).toHaveClass('text-text-secondary')
    expect(screen.getByText(formatDate('2026-02-01T00:00:00Z'))).toBeInTheDocument()
    expect(screen.queryByText('Not yet')).toBeNull()
  })
})
