import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ReviewCard } from './ReviewCard'
import type { CriticConflict, CriticReview, CriticReviewCompact } from '../../lib/critic-review'
import type { ReviewShipment } from '../../hooks/use-review-queue'

const conflictEta: CriticConflict = {
  field: 'eta',
  label: 'ETA',
  candidates: [
    { value: '2026-07-20', source: 'System' },
    { value: '2026-07-23', source: 'SO' },
  ],
  rationale: 'Newer SO supersedes stored ETA.',
}

const conflictHbl: CriticConflict = {
  field: 'hbl_awb_fcr_no',
  label: 'HBL',
  candidates: [
    { value: 'SE26061400005', source: 'Final B/L' },
    { value: 'SE26061400006', source: 'Draft B/L' },
  ],
  rationale: 'Two co-current HBLs in one email.',
}

function baseReview(over: Partial<CriticReview> = {}): CriticReview {
  return {
    confidence: { score: 0.32, band: 'low', label: 'Low confidence' },
    summary: 'Two HBLs and an ETA mismatch',
    observations: [],
    priorState: { headline: '', fields: [] },
    proposedChanges: [
      // Must NEVER appear as a conflict row when conflicts is empty/absent
      { field: 'etd', from: null, to: '2026-08-01' },
    ],
    riskFlags: [{ code: 'MULTI_ID', severity: 'low', message: 'Two strong IDs in one email' }],
    conflicts: [conflictEta, conflictHbl],
    recommendedHumanAction: 'Resolve conflicts then confirm',
    reasons: ['conflicting_identifiers'],
    ...over,
  }
}

function baseShipment(over: Partial<ReviewShipment> = {}): ReviewShipment {
  return {
    id: 'leg-1',
    bookingNo: 'BY058417',
    soNo: null,
    customer: 'Cole Haan',
    forwarder: 'SEH',
    route: 'CNYTN→GBFXT',
    state: null,
    status: 'BOOKED',
    reviewReasons: ['conflicting_identifiers'],
    criticReviewCompact: {
      band: 'low',
      summary: 'Two HBLs',
      topConflictType: 'Two strong IDs in one email',
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-10T12:00:00.000Z',
    poCount: 1,
    dismissedAt: null,
    ...over,
  }
}

const compact: CriticReviewCompact = {
  band: 'low',
  summary: 'Two HBLs',
  topConflictType: 'Two strong IDs in one email',
}

describe('ReviewCard', () => {
  it('collapsed: shows band + identity, no conflict table or AI comment', () => {
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview()}
        compact={compact}
        defaultExpanded={false}
      />,
    )

    expect(screen.getByText('Low')).toBeInTheDocument()
    expect(screen.getByText(/Cole Haan/)).toBeInTheDocument()
    expect(screen.getByText(/BY058417/)).toBeInTheDocument()
    expect(screen.getByText(/CNYTN→GBFXT/)).toBeInTheDocument()

    expect(screen.queryByText('Low · Two strong IDs in one email')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByTestId('why-review')).toBeNull()
    expect(screen.queryByText('ETA')).toBeNull()
    expect(screen.queryByText('HBL')).toBeNull()
    // proposedChanges must not surface when collapsed either
    expect(screen.queryByText('etd')).toBeNull()
  })

  it('expanded: shows AI comment + only conflicts[] rows (not proposedChanges)', async () => {
    const user = userEvent.setup()
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview()}
        compact={compact}
        defaultExpanded={false}
      />,
    )

    await user.click(screen.getByRole('button', { name: /expand|details|show/i }))

    expect(screen.getByText('Low · Two strong IDs in one email')).toBeInTheDocument()

    const table = screen.getByRole('table')
    expect(within(table).getByText('ETA')).toBeInTheDocument()
    expect(within(table).getByText('HBL')).toBeInTheDocument()
    // Column headers
    expect(within(table).getByText('Existing')).toBeInTheDocument()
    expect(within(table).getByText('Proposed')).toBeInTheDocument()
    expect(within(table).getByText('Resolution')).toBeInTheDocument()
    expect(within(table).queryByText('Recommended')).toBeNull()

    // proposedChanges field must not become a row
    expect(within(table).queryByText(/etd/i)).toBeNull()
    expect(screen.queryByText('2026-08-01')).toBeNull()
  })

  it('expanded with empty conflicts: shows WHY it is queued (risk flags), no invented rows', async () => {
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview({
          conflicts: [],
          riskFlags: [
            {
              code: 'WEAK_IDENTITY',
              severity: 'medium',
              message: 'No strong booking/SO/B/L identity and no PO — hard to place this email on a shipment.',
            },
          ],
        })}
        compact={compact}
        defaultExpanded={true}
      />,
    )

    const why = screen.getByTestId('why-review')
    expect(within(why).getByText(/No strong booking\/SO\/B\/L identity/)).toBeInTheDocument()
    expect(screen.queryByText(/No field conflicts/i)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('2026-08-01')).toBeNull()
  })

  it('why-review renders alongside the conflict table when both exist', async () => {
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview()}
        compact={compact}
        defaultExpanded={true}
      />,
    )
    expect(screen.getByTestId('why-review')).toBeInTheDocument()
    expect(within(screen.getByTestId('why-review')).getByText('Two strong IDs in one email')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('why-review falls back to humanized reviewReasons when the critic payload is absent', () => {
    render(
      <ReviewCard
        shipment={baseShipment({ reviewReasons: ['conflicting_identifiers'] })}
        criticReview={null}
        compact={null}
        defaultExpanded={true}
      />,
    )
    const why = screen.getByTestId('why-review')
    expect(why.textContent!.length).toBeGreaterThan(0)
    expect(screen.getByTestId('no-critic-note')).toBeInTheDocument()
    expect(screen.getByTestId('no-critic-note').textContent).toMatch(/No agent analysis/)
  })

  it('shows no-critic-note whenever criticReview is null (even with no reasons)', () => {
    render(
      <ReviewCard
        shipment={baseShipment({ reviewReasons: [] })}
        criticReview={null}
        compact={null}
        defaultExpanded={true}
      />,
    )
    expect(screen.getByTestId('no-critic-note')).toBeInTheDocument()
  })

  // The queue's riskFlags and ShipTrack's committer reviewReasons are two DIFFERENT sources, not a
  // primary + backup: master-data misses exist only on the ShipTrack side. Real leg 31DFB19C.
  it('why-review shows a ShipTrack reason no risk flag explains (master-data miss), alongside the flags', () => {
    render(
      <ReviewCard
        shipment={baseShipment({
          reviewReasons: [
            '3 unresolved field conflict(s)',
            'forwarder_name "A.P. Moller - Maersk" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)',
          ],
        })}
        criticReview={baseReview({
          conflicts: [],
          riskFlags: [
            {
              code: 'INTRA_EMAIL_FIELD_CONFLICT',
              severity: 'high',
              message: '3 unresolved field conflict(s) across the email thread — values disagree.',
            },
          ],
        })}
        compact={compact}
        defaultExpanded={true}
      />,
    )
    const why = screen.getByTestId('why-review')
    // the flag itself
    expect(within(why).getByText(/3 unresolved field conflict\(s\) across the email thread/)).toBeInTheDocument()
    // the ShipTrack-only reason must NOT be swallowed
    expect(within(why).getByText(/Forwarder "A.P. Moller - Maersk" did not match master data/)).toBeInTheDocument()
    // ...and its duplicate-of-the-flag sibling must not be repeated
    expect(within(why).queryByText(/field\(s\) received different values from different emails/)).toBeNull()
  })

  it('why-review does not repeat a reason a risk flag already explains', () => {
    render(
      <ReviewCard
        shipment={baseShipment({
          reviewReasons: [
            "Email references an attachment that wasn't received — information may be incomplete",
          ],
        })}
        criticReview={baseReview({
          conflicts: [],
          riskFlags: [
            {
              code: 'MISSING_ATTACHMENT',
              severity: 'high',
              message: 'Email references an attachment that was not received — cargo details may be incomplete.',
            },
          ],
        })}
        compact={compact}
        defaultExpanded={true}
      />,
    )
    const items = within(screen.getByTestId('why-review')).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toMatch(/cargo details may be incomplete/)
  })

  it('requires a note before Save & Approve when the resolution differs from the stored value', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview({ conflicts: [conflictEta] })}
        compact={compact}
        defaultExpanded={true}
        onSaveAndApprove={onSave}
      />,
    )

    const resolution = screen.getByLabelText(/resolution for eta/i) as HTMLInputElement
    // No pre-filled recommendation — the operator chooses.
    expect(resolution.value).toBe('')

    const saveBtn = screen.getByRole('button', { name: /save.*approve/i })
    // Enter a value that differs from the stored (Existing) value → a note becomes mandatory.
    await user.type(resolution, '2026-07-25')

    expect(saveBtn).toBeDisabled()
    expect(screen.getByText(/Add a note before Save & Approve/i)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Operator override — confirmed with carrier')
    expect(saveBtn).not.toBeDisabled()

    await user.click(saveBtn)
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.note).toMatch(/Operator override/)
    expect(payload.fields).toMatchObject({ eta: '2026-07-25' })
    expect(payload.expectedUpdatedAt).toBe('2026-07-10T12:00:00.000Z')
  })

  it('source emails: chips open the reading-pane pop-up window', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    vi.stubGlobal('open', open)

    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview()}
        compact={compact}
        emails={[{ id: 'em-1', subject: 'Final B/L for KOHL', sender: 'ops@fwd.com', receivedAt: null, emailType: 'Final B/L' }]}
        defaultExpanded={true}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open source email/i }))
    expect(open).toHaveBeenCalledTimes(1)
    const [url, target, features] = open.mock.calls[0]
    expect(url).toBe('/email/em-1?type=Final%20B%2FL')
    expect(target).toBe('email_em-1')
    expect(features).toContain('popup')
    vi.unstubAllGlobals()
  })

  it('source emails: no chips rendered when the leg has none', () => {
    render(
      <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} defaultExpanded={true} />,
    )
    expect(screen.queryByTestId('source-emails')).toBeNull()
  })

  it('renders an Open full shipment link when fullShipmentPath is set', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview()}
          compact={compact}
          fullShipmentPath="/shipments/leg-1"
          defaultExpanded={true}
        />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /open full shipment/i })
    expect(link).toHaveAttribute('href', '/shipments/leg-1')
  })

  it('readOnly: shows resolved values, hides inputs and primary Save button', () => {
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview({ conflicts: [conflictEta] })}
        compact={compact}
        defaultExpanded={true}
        readOnly
        onSaveAndApprove={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText(/resolution for eta/i)).toBeNull()
    expect(screen.queryByRole('textbox', { name: /note/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /save.*approve/i })).toBeNull()
    // Still shows the Existing / Proposed candidate values as text
    expect(screen.getByText('2026-07-20')).toBeInTheDocument()
    expect(screen.getAllByText('2026-07-23').length).toBeGreaterThanOrEqual(1)
  })
})

const weakIdentityReview = () =>
  baseReview({
    conflicts: [],
    riskFlags: [{ code: 'WEAK_IDENTITY', severity: 'medium', message: 'No strong booking/SO/B/L identity and no PO — hard to place this email on a shipment.' }],
  })

describe('identify section (WEAK_IDENTITY / AMBIGUOUS_MATCH legs)', () => {
  it('renders only for WEAK_IDENTITY legs with an onIdentify handler', () => {
    const { rerender } = render(
      <ReviewCard shipment={baseShipment()} criticReview={weakIdentityReview()} compact={compact} defaultExpanded onIdentify={vi.fn()} />,
    )
    expect(screen.getByTestId('identify-shipment')).toBeInTheDocument()
    rerender(
      <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} defaultExpanded onIdentify={vi.fn()} />,
    )
    expect(screen.queryByTestId('identify-shipment')).toBeNull()
  })

  it('renders for a leg whose only flag is AMBIGUOUS_MATCH', () => {
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview({
          conflicts: [],
          riskFlags: [{ code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'Could belong to more than one shipment.' }],
        })}
        compact={compact}
        defaultExpanded
        onIdentify={vi.fn()}
      />,
    )
    expect(screen.getByTestId('identify-shipment')).toBeInTheDocument()
    expect(screen.getByText(/Multiple matching shipments/i)).toBeInTheDocument()
  })

  it('typed key that exists elsewhere → shows the candidate + one-click link', async () => {
    const user = userEvent.setup()
    const onIdentify = vi.fn().mockResolvedValue({
      outcome: 'candidate',
      candidate: { shipmentId: 'TARGET-1', jobNo: 'JOB-2026-0017', matchedValue: 'BX845666' },
    })
    const onLink = vi.fn().mockResolvedValue(undefined)
    render(
      <ReviewCard shipment={baseShipment()} criticReview={weakIdentityReview()} compact={compact} defaultExpanded onIdentify={onIdentify} onLink={onLink} />,
    )
    await user.type(screen.getByLabelText(/identity value/i), 'BX845666')
    await user.click(screen.getByRole('button', { name: /apply identity/i }))
    expect(onIdentify).toHaveBeenCalledWith('booking_no', 'BX845666')
    expect(await screen.findByText(/JOB-2026-0017/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /link into this shipment/i }))
    expect(onLink).toHaveBeenCalledWith('TARGET-1')
  })

  it('ambiguous result shows the count and offers no link', async () => {
    const user = userEvent.setup()
    const onIdentify = vi.fn().mockResolvedValue({ outcome: 'ambiguous', count: 3 })
    render(
      <ReviewCard shipment={baseShipment()} criticReview={weakIdentityReview()} compact={compact} defaultExpanded onIdentify={onIdentify} />,
    )
    await user.type(screen.getByLabelText(/identity value/i), '001')
    await user.click(screen.getByRole('button', { name: /apply identity/i }))
    expect(await screen.findByText(/3 shipments carry this key/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link into/i })).toBeNull()
  })
})
