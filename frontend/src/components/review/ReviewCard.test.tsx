import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ReviewCard } from './ReviewCard'
import type { CriticConflict, CriticReview, CriticReviewCompact } from '../../lib/critic-review'
import type { ReviewShipment } from '../../hooks/use-review-queue'
import type { LinkedPO } from '../../hooks/use-shipments'

vi.mock('../../hooks/use-purchase-orders', () => ({
  useCreatePurchaseOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePurchaseOrder: () => ({ mutate: vi.fn(), isPending: false }),
  useUnlinkShipmentFromPO: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useLinkShipmentToPO: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

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

    // AI comment strip removed (repeated Low band + Needs attention / conflict table)
    expect(screen.queryByTestId('ai-comment-line')).toBeNull()
    expect(screen.queryByText('Low · Two strong IDs in one email')).toBeNull()

    const table = screen.getByRole('table')
    expect(within(table).getByText('ETA')).toBeInTheDocument()
    // OUR label, not the payload's bare 'HBL' — reviewFieldLabel prefers EDITABLE_FIELDS.
    expect(within(table).getByText('HBL / HAWB / FCR No.')).toBeInTheDocument()
    // Multi-candidate HBL: both proposals visible in AI Proposed (not buried in a datalist)
    expect(within(table).getByText('SE26061400005')).toBeInTheDocument()
    expect(within(table).getByText('SE26061400006')).toBeInTheDocument()
    expect(within(table).getByTestId('multi-candidate-proposed')).toBeInTheDocument()
    // Column headers — default view shows agent proposals; Resolution/Edited only after Edit / changes.
    expect(within(table).getByText('Current')).toBeInTheDocument()
    expect(within(table).getByTestId('proposed-column-header')).toHaveTextContent('AI Proposed')
    expect(within(table).queryByText('Resolution')).toBeNull()
    expect(within(table).queryByText('Edited')).toBeNull()
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
    expect(within(why).getByText(/No booking, SO, B\/L, or PO — cannot place this email/)).toBeInTheDocument()
    expect(within(why).getByText(/Real Shipment\?/)).toBeInTheDocument()
    expect(screen.queryByText(/No field conflicts/i)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('2026-08-01')).toBeNull()
  })

  it('WEAK_IDENTITY with linkedPOs shows only-PO Needs attention copy', () => {
    render(
      <ReviewCard
        shipment={
          baseShipment({
            linkedPOs: [
              {
                id: 'po1',
                linkId: 'l1',
                poNumber: 'PO-123',
                quantity: null,
                totalQuantity: null,
                quantityUnit: null,
              } satisfies LinkedPO,
            ],
          } as never)
        }
        criticReview={baseReview({
          conflicts: [],
          riskFlags: [
            {
              code: 'WEAK_IDENTITY',
              severity: 'medium',
              message:
                'No strong booking/SO/B/L identity and no PO — hard to place this email on a shipment.',
            },
          ],
        })}
        compact={compact}
        defaultExpanded={true}
      />,
    )

    const why = screen.getByTestId('why-review')
    expect(within(why).getByText(/Only PO known — add booking, SO, or B\/L/)).toBeInTheDocument()
    expect(within(why).queryByText(/or PO — cannot place/)).not.toBeInTheDocument()
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
    expect(screen.getByTestId('needs-group-which_shipment')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('needs-group-which_shipment')).getByText(
        /more than one booking\/SO\/B\/L number/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('why-review falls back to humanized reviewReasons when the critic payload is absent', () => {
    // Decision-class reason (rule A: Review hides pure FYI). Use riskFlag so lineId is w-po-only.
    render(
      <ReviewCard
        shipment={baseShipment({ reviewReasons: [] })}
        criticReview={{
          confidence: { score: 50, band: 'medium', label: 'm' },
          summary: '',
          observations: [],
          priorState: { headline: '', fields: [] },
          proposedChanges: [],
          riskFlags: [
            {
              code: 'PO_ONLY_WEAK_MATCH',
              severity: 'high',
              message: 'Matched on PO alone',
            },
          ],
          recommendedHumanAction: 'review',
          reasons: [],
        }}
        compact={null}
        defaultExpanded={true}
      />,
    )
    // When critic is present, no-critic-note is absent — separate case: decision line still surfaces
    const why = screen.getByTestId('why-review')
    expect(why.textContent).toMatch(/Linked by PO only|PO only/i)
  })

  it('shows no-critic-note when criticReview is null and decision reason is present', () => {
    render(
      <ReviewCard
        shipment={baseShipment({
          reviewReasons: ['AI confidence low — verify extraction'],
        })}
        criticReview={null}
        compact={null}
        defaultExpanded={true}
      />,
    )
    expect(screen.getByTestId('why-review').textContent).toMatch(/Verify extraction \(AI low confidence\)/)
    expect(screen.getByTestId('no-critic-note')).toBeInTheDocument()
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

  // #146: no critic conflicts → conflict-style reviewReasons must not say "below" (no field table on card).
  it('why-review does not promise field table when criticReview is null and reasons cite backend conflict', () => {
    render(
      <ReviewCard
        shipment={baseShipment({ reviewReasons: ['backend conflict on qty, gross_weight'] })}
        criticReview={null}
        compact={null}
        defaultExpanded={true}
      />,
    )
    const why = screen.getByTestId('why-review')
    // gross_weight omitted from flag copy (not on Order Details)
    expect(why.textContent).toMatch(/Email and system differ on Qty — choose which values to keep/)
    expect(why.textContent).not.toMatch(/gross_weight|Gross Weight|HTS/i)
    expect(why.textContent).not.toMatch(/below|highlighted fields/)
    expect(why.textContent).toMatch(/Fields Disagree/)
  })

  // The queue's riskFlags and ShipTrack's committer reviewReasons are two DIFFERENT sources, not a
  // primary + backup: master-data misses exist only on the ShipTrack side. Real leg 31DFB19C.
  // Rule A (2026-07-20, updated): Master miss is decision on Review — operator must resolve Mesh.
  it('why-review shows decision field conflict and master miss (Mesh resolve on Review desk)', () => {
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
    expect(within(why).getByText(/Field values disagree|field\(s\) disagree/i)).toBeInTheDocument()
    // Master miss is decision on Review (tagDesk → operator resolves Mesh party/port)
    expect(within(why).getByText(/Master Miss/)).toBeInTheDocument()
    expect(within(why).getByText(/A\.P\. Moller - Maersk|Mesh Database/i)).toBeInTheDocument()
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
    expect(items[0]!.textContent).toMatch(
      /Email says there is an attachment, but none was received — cargo may be incomplete/,
    )
  })

  // Needs attention (2026-07-17): conflict table owns field diffs — hide conflict-class flags/reasons.
  // Cap 2: non-field decision context only (multi_id / no_identity / master_miss).
  it('why-review hides conflict flags when the conflict table is present (table owns comparison)', () => {
    render(
      <ReviewCard
        shipment={baseShipment({
          reviewReasons: [
            '3 field conflict(s)',
            'backend conflict on qty, gross_weight, measurement',
            'no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment',
            'pol "CHINADONG GGUANG" did not exact/curated-match a port master — left unlinked',
          ],
        })}
        criticReview={baseReview({
          conflicts: [
            {
              field: 'qty',
              label: 'Qty',
              candidates: [
                { value: '10', source: 'System' },
                { value: '12', source: 'SO' },
              ],
              rationale: 'Qty disagree',
            },
          ],
          riskFlags: [
            {
              code: 'BACKEND_CONFLICT',
              severity: 'high',
              message: 'Email disagrees with what is already stored on Qty, Gross weight, Measurement — needs a human call.',
            },
            {
              code: 'INTRA_EMAIL_FIELD_CONFLICT',
              severity: 'high',
              message: '3 field conflicts — values disagree (see conflict table).',
            },
            {
              code: 'PO_ONLY_WEAK_MATCH',
              severity: 'medium',
              message: 'Matched an existing shipment on PO alone — could be a different leg sharing the same PO.',
            },
          ],
        })}
        compact={compact}
        defaultExpanded={true}
      />,
    )
    const why = screen.getByTestId('why-review')
    expect(screen.getByTestId('needs-attention')).toBeInTheDocument()
    expect(within(why).getByText(/Needs attention/i)).toBeInTheDocument()
    // Conflict-class flags suppressed — table already shows Qty
    expect(within(why).queryByText(/Email disagrees with what is already stored/)).toBeNull()
    expect(within(why).queryByText(/3 field conflicts — values disagree/)).toBeNull()
    expect(within(why).queryByText(/^3 field conflict\(s\)$/)).toBeNull()
    expect(screen.queryByTestId('needs-group-fields_disagree')).toBeNull()
    // PO-only + thin collapse into w-po-thin (decision); port miss is FYI (rule A — detail only)
    expect(
      within(why).getByText(
        /Thin mail linked by PO only — confirm it belongs in tracking and on this shipment|Linked by PO only/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByTestId('needs-group-which_shipment')).toBeInTheDocument()
    // Table still owns the field comparison
    expect(screen.getByRole('table')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const resolution = screen.getByLabelText(/proposed value for eta/i) as HTMLInputElement
    // Pre-filled with the agent's proposal — the operator accepts or edits it.
    expect(resolution.value).toBe('2026-07-23')

    // in edit mode the primary button is Submit
    const saveBtn = screen.getByRole('button', { name: /^submit$/i })
    // Enter a value that differs from the stored (Existing) value → a note becomes mandatory.
    await user.clear(resolution)
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

    await user.click(screen.getByRole('button', { name: /source emails/i })) // expand (collapsed by default)
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

  it('shows Open shipment on the expanded panel (Active queue has no row Action link)', () => {
    render(
      <ReviewCard
        shipment={baseShipment()}
        criticReview={baseReview()}
        compact={compact}
        defaultExpanded={true}
      />,
    )
    const open = screen.getByRole('link', { name: /open shipment/i })
    expect(open).toBeInTheDocument()
    expect(open).toHaveAttribute('href', expect.stringMatching(/\/shipments\//))
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

  // Resolved = the Approved/Rejected queue views and any non-provisional shipment. Needs attention
  // is a triage prompt; once the item is resolved it is answered, so it stops being shown.
  it('offers the source email per candidate, only when that email is actually on the shipment', async () => {
    const user = userEvent.setup()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const conflict: CriticConflict = {
      field: 'forwarder_name',
      label: 'Forwarder',
      candidates: [
        { value: 'STORED CO', source: 'System' },
        { value: 'UNITEX LOGISTICS LTD.', source: 'SO', sourceEmailId: 'gmid-known' },
        { value: 'BLUE ANCHOR LINE', source: 'Booking Request', sourceEmailId: 'gmid-missing' },
      ],
      rationale: 'Two emails disagree.',
    }
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflict] })}
          compact={compact}
          defaultExpanded
          emails={[
            { id: 'db-uuid-1', graphMessageId: 'gmid-known', subject: 'SO for GZL', sender: null },
          ]}
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    // one icon: the known email. The unmatched candidate and the System side get none.
    const icons = screen.getAllByTestId('candidate-source-email')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveAttribute('title', 'Open the source email — SO for GZL')

    await user.click(icons[0]!)
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/email/db-uuid-1'),
      'email_db-uuid-1',
      expect.stringContaining('popup'),
    )
    open.mockRestore()
  })

  it('shows no source icon when the matching email body is gone', () => {
    const conflict: CriticConflict = {
      field: 'forwarder_name',
      label: 'Forwarder',
      candidates: [
        { value: 'A', source: 'SO', sourceEmailId: 'gmid-known' },
        { value: 'B', source: 'Booking Request', sourceEmailId: 'gmid-known' },
      ],
      rationale: 'x',
    }
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflict] })}
          compact={compact}
          defaultExpanded
          emails={[
            { id: null, graphMessageId: 'gmid-known', subject: '(gone)', sender: null, bodyMissing: true },
          ]}
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('candidate-source-email')).toBeNull()
  })

  it('readOnly: Needs attention is gone once the item is resolved', () => {
    const props = {
      shipment: baseShipment(),
      criticReview: baseReview({
        conflicts: [],
        riskFlags: [
          { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'This email matched more than one existing leg.' },
        ],
      }),
      compact,
      defaultExpanded: true,
    }
    const { rerender } = render(<ReviewCard {...props} />)
    // unresolved → the prompt is there
    expect(screen.getByTestId('needs-attention')).toBeInTheDocument()
    expect(screen.getByText('Needs Attention')).toBeInTheDocument()

    rerender(<ReviewCard {...props} readOnly />)
    expect(screen.queryByTestId('needs-attention')).toBeNull()
    expect(screen.queryByText('Needs Attention')).toBeNull()
    expect(screen.queryByTestId('needs-group-which_shipment')).toBeNull()
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

  it('F11: multi-candidate without target — Confirm as separate enabled and calls onApprove', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onLink = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({
            conflicts: [],
            riskFlags: [
              { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'Could belong to more than one shipment.' },
            ],
            matchAmbiguity: {
              kind: 'multi_candidate',
              candidates: [
                {
                  shipmentId: 'id-a',
                  jobNo: 'JOB-A',
                  so_no: 'SO1',
                  booking_no: 'BK1',
                  matchedBy: 'strong_key',
                },
                {
                  shipmentId: 'id-b',
                  jobNo: 'JOB-B',
                  so_no: 'SO2',
                  booking_no: 'BK2',
                  matchedBy: 'strong_key',
                },
              ],
            },
          })}
          compact={compact}
          defaultExpanded
          onApprove={onApprove}
          onLink={onLink}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByTestId('confirm-as-separate')
    expect(btn).toBeEnabled()
    await user.click(btn)
    expect(onApprove).toHaveBeenCalled()
    expect(onLink).not.toHaveBeenCalled()
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
    expect(onLink).toHaveBeenCalledWith(
      'TARGET-1',
      expect.objectContaining({ fields: expect.any(Object) }),
    )
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

describe('conflict table — read-only by default, Edit to change values', () => {
  it('reads clean by default: existing → proposed, no inputs, no per-row controls', () => {
    render(
      <MemoryRouter>
        <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} defaultExpanded />
      </MemoryRouter>,
    )
    const table = screen.getByRole('table')
    expect(within(table).getByText('2026-07-20')).toBeInTheDocument()
    expect(within(table).getByText('2026-07-23')).toBeInTheDocument()
    // the noisy bits are gone until you ask for them
    expect(within(table).queryByRole('textbox')).toBeNull()
    expect(screen.queryByLabelText(/confirm eta/i)).toBeNull()
  })

  it('Edit reveals inputs pre-filled with the agent proposal; multi-candidate keeps every option', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview()}
          compact={compact}
          defaultExpanded
          onSaveAndApprove={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('AI Proposed')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('Resolution')
    expect((screen.getByLabelText(/proposed value for eta/i) as HTMLInputElement).value).toBe('2026-07-23')
    // hbl has NO system candidate and two proposals → the FIRST is the pick (radio below), both visible.
    // #360: the free-typing input stays blank while a pick is active — the pick lives in the radio,
    // and pre-filling it read as "this text will be written".
    expect((screen.getByLabelText(/proposed value for hbl/i) as HTMLInputElement).value).toBe('')
    const multi = screen.getByTestId('multi-candidate-proposed')
    expect(within(multi).getByText('SE26061400005')).toBeInTheDocument()
    expect(within(multi).getByText('SE26061400006')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /SE26061400005/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /SE26061400006/i })).not.toBeChecked()
  })

  it('hides bag-level Item / Style No. conflict (styles are per-PO, not Order Details)', () => {
    const conflictStyles: CriticConflict = {
      field: 'item_style_no',
      label: 'Item / Style No.',
      candidates: [
        {
          value: '26-HMIGHLE-0293-1,26-HMIGHLE-0281-1,26-HMIGHLE-0280-1',
          source: 'System',
        },
        { value: '26-HMIGHLE-0281-1', source: 'SO' },
      ],
      rationale: 'SO lists one style; system has a broadcast list.',
    }
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflictStyles] })}
          compact={compact}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    // Only bag style conflict → no decision grid (same as GW/HTS hide)
    expect(screen.queryByTestId('review-decision-grid')).toBeNull()
    expect(screen.queryByTestId('style-list-editor')).toBeNull()
    expect(screen.getByTestId('review-judgment-only')).toBeInTheDocument()
  })

  it('Cancel leaves edit mode AND backs the edit out', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflictEta] })}
          compact={compact}
          defaultExpanded
          onSaveAndApprove={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const eta = screen.getByLabelText(/proposed value for eta/i)
    await user.clear(eta)
    await user.type(eta, '2026-07-25')
    // mid-edit the column reads Resolution
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('Resolution')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    // discarded → back to the agent's proposal, not a lingering "Edited" state
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('AI Proposed')
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^submit$/i })).toBeNull()
  })

  it('Edit swaps the idle actions for Cancel + Submit', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflictEta] })}
          compact={compact}
          defaultExpanded
          onApprove={vi.fn().mockResolvedValue(undefined)}
          onSaveAndApprove={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>,
    )
    // idle
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep current/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    // editing — only the two ways out
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /keep current/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^approve$/i })).toBeNull()
  })

  it('the approve button names how many stored values it will overwrite', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflictEta] })}
          compact={compact}
          defaultExpanded
          onSaveAndApprove={onSave}
        />
      </MemoryRouter>,
    )
    // One click, but a click that states what it accepts — not a bare "Approve".
    const approve = screen.getByRole('button', { name: /^approve$/i })
    expect(approve).not.toBeDisabled()
    await user.click(approve)
    expect(onSave.mock.calls[0][0].fields).toMatchObject({ eta: '2026-07-23' })
  })

  it('editing a value still demands a note, and carries the agent original for training', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflictEta] })}
          compact={compact}
          defaultExpanded
          onSaveAndApprove={onSave}
        />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const eta = screen.getByLabelText(/proposed value for eta/i)
    await user.clear(eta)
    await user.type(eta, '2026-07-25')

    // still in edit mode → the primary button is Submit
    const approve = screen.getByRole('button', { name: /^submit$/i })
    expect(approve).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Carrier confirmed the 25th')
    expect(approve).not.toBeDisabled()

    await user.click(approve)
    expect(onSave.mock.calls[0][0].corrections).toEqual([
      { field: 'eta', existing: '2026-07-20', aiProposed: '2026-07-23', humanFinal: '2026-07-25' },
    ])
  })

  it('groups under the same headers as Order Details, and shows only contested rows', () => {
    render(
      <MemoryRouter>
        <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} defaultExpanded />
      </MemoryRouter>,
    )
    const table = screen.getByRole('table')
    // hbl_awb_fcr_no → Cargo & Logistics (where Order Details files it), eta → Key Dates.
    expect(within(table).getByText('Cargo & Logistics')).toBeInTheDocument()
    expect(within(table).getByText('Key Dates')).toBeInTheDocument()
    // groups with no conflict never render a header
    expect(within(table).queryByText('Order Info')).toBeNull()
    expect(within(table).queryByText('Shipping')).toBeNull()
    // and a matching field is not a row at all
    expect(within(table).queryByText('Vessel')).toBeNull()
  })
})

describe('embedded in the queue table — the row above already states identity', () => {
  it('renders no identity header, no second chevron, and no duplicate row actions', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview()}
          compact={compact}
          defaultExpanded
          embedded
          onApprove={vi.fn()}
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    // The queue row already shows band + customer + booking + route + status. Repeating them here
    // (and adding a second expand chevron next to the row's own) is what made the page read double.
    expect(screen.queryByRole('button', { name: /collapse details|expand details/i })).toBeNull()
    expect(screen.queryByText(/CNYTN→GBFXT/)).toBeNull()
    expect(screen.queryByText(/BY058417/)).toBeNull()
    // ...but the detail the row cannot show is still here
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByTestId('why-review')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep current/i })).toBeInTheDocument()
    // Not shipment is Documents-only (unlinked docs). Review queue has no dismiss path.
    expect(screen.queryByRole('button', { name: /not shipment/i })).toBeNull()
  })

  it('Keep current confirms without applying AI Proposed field changes', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn().mockResolvedValue(undefined)
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview({ conflicts: [conflictEta] })}
          compact={compact}
          defaultExpanded
          embedded
          onApprove={onApprove}
          onSaveAndApprove={onSave}
        />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /keep current/i }))
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('still shows identity when NOT embedded (standalone use)', () => {
    render(
      <MemoryRouter>
        <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} defaultExpanded />
      </MemoryRouter>,
    )
    expect(screen.getByText(/CNYTN→GBFXT/)).toBeInTheDocument()
  })
})

describe('units — a bare number is unreadable, but a fabricated unit is worse', () => {
  const conflictQty: CriticConflict = {
    field: 'qty',
    label: 'Qty',
    candidates: [{ value: '260', source: 'System' }, { value: '13516', source: 'Booking Request' }],
    rationale: 'Email states a different quantity.',
  }
  const conflictMeas: CriticConflict = {
    field: 'measurement',
    label: 'Measurement',
    candidates: [{ value: '1.26', source: 'System' }, { value: '4.252', source: 'SO' }],
    rationale: '',
  }
  const conflictUom: CriticConflict = {
    field: 'qty_unit',
    label: 'UOM',
    candidates: [{ value: 'cartons', source: 'System' }, { value: 'pieces', source: 'Booking Request' }],
    rationale: 'Shipped in cartons, ordered in pieces.',
  }
  const withUom = (over = {}) => ({ ...baseShipment(over), quantityUnit: 'cartons' })

  it('does not show Gross Weight, Measurement, or HTS Code conflict rows (hidden from Order Details)', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={withUom()}
          criticReview={baseReview({
            conflicts: [
              {
                field: 'gross_weight',
                label: 'Gross weight',
                candidates: [{ value: '23', source: 'System' }, { value: '87', source: 'SO' }],
                rationale: '',
              },
              {
                field: 'hts_code',
                label: 'HTS Code',
                candidates: [{ value: '6110', source: 'System' }, { value: '6110 11', source: 'SO' }],
                rationale: '',
              },
              conflictMeas,
              conflictQty,
            ],
          })}
          compact={compact}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Gross Weight')).toBeNull()
    expect(screen.queryByText('HTS Code')).toBeNull()
    expect(screen.queryByText('Measurement')).toBeNull()
    // Still shows a visible cargo conflict so the table is not empty
    expect(screen.getByText('Total Quantity')).toBeTruthy()
  })

  it("carries the leg's UOM onto qty when the email does not dispute the unit", () => {
    render(
      <MemoryRouter>
        <ReviewCard shipment={withUom()} criticReview={baseReview({ conflicts: [conflictQty] })} compact={compact} defaultExpanded />
      </MemoryRouter>,
    )
    const row = screen.getByText('Total Quantity').closest('tr')!
    expect(within(row).getAllByText('cartons')).toHaveLength(2)
  })

  it('will NOT stamp the stored UOM on the agent value when the UOM is itself contested', () => {
    // 260 cartons vs 13516 pieces: labelling 13516 "cartons" asserts something nobody said, and it
    // is exactly the mistake that makes one PO look like it ordered the whole booking.
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={withUom()}
          criticReview={baseReview({ conflicts: [conflictQty, conflictUom] })}
          compact={compact}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    const row = screen.getByText('Total Quantity').closest('tr')!
    // stored side keeps its unit — we know that one
    expect(within(row).getAllByText('cartons')).toHaveLength(1)
    // Numbers group for reading: 13516 renders as 13,516 (display only — the input keeps digits).
    expect(within(row).getByText('13,516')).toBeInTheDocument()
  })
})

describe('source emails — identify WHICH email, and which is newer', () => {
  const emails = [
    {
      id: 'e-old',
      subject: 'RE: ACNS/ NEW PACKING LIST FOR SE,UK ,US ,JP, KOREA,and CN ORDER',
      sender: 'LingTan@cobaltknitwear.com',
      receivedAt: '2026-05-19T07:00:00.000Z',
      emailType: 'Other',
    },
    {
      id: 'e-new',
      subject: "Re: KOHL'S (POE) Final Submit DOCS, Invoice PL (YAQI) LOS ANGELES",
      sender: 'YumiHuang@NeoTangent.com',
      receivedAt: '2026-05-19T14:44:00.000Z',
      emailType: 'Final B/L',
    },
  ]

  it('shows the full subject plus sender and timestamp, and no type tag', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} emails={emails} defaultExpanded />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /source emails/i })) // collapsed by default now
    const box = screen.getByTestId('source-emails')
    const row = within(box).getByText(/KOHL'S \(POE\) Final Submit DOCS/).closest('button')!
    expect(within(row).getByText(/YumiHuang@NeoTangent.com/)).toBeInTheDocument()
    // date only — the rendered time is local, and asserting it would pin the test to a timezone
    expect(row.textContent).toMatch(/19 May 2026/)
    // the classification identifies nothing (and 'Other' is overloaded) — the timestamp does the job
    expect(within(box).queryByText('Final B/L')).toBeNull()
    expect(within(box).queryByText('UNCLASSIFIED')).toBeNull()
  })

  it('lists the newest email first', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard shipment={baseShipment()} criticReview={baseReview()} compact={compact} emails={emails} defaultExpanded />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /source emails/i }))
    const rows = within(screen.getByTestId('source-emails-list')).getAllByRole('button')
    expect(rows[0]!.textContent).toMatch(/KOHL'S/)
    expect(rows[1]!.textContent).toMatch(/ACNS/)
  })

  it('shows POs & styles section from linkedPOs', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={
            baseShipment({
              linkedPOs: [{ id: 'po1', linkId: 'l1', poNumber: '1', itemStyleNo: 'A' }],
            } as never)
          }
          criticReview={baseReview()}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/POs & styles/i)).toBeInTheDocument()
  })

  it('hides Item/Style bag conflict when linked POs exist', () => {
    const conflicts: CriticConflict[] = [
      {
        field: 'item_style_no',
        label: 'Item / Style No.',
        candidates: [
          { value: 'A,B,C', source: 'System' },
          { value: 'A,B,C', source: 'SO' },
        ],
        rationale: 'x',
      },
      {
        field: 'qty',
        label: 'Total Quantity',
        candidates: [
          { value: '10', source: 'System' },
          { value: '20', source: 'SO' },
        ],
        rationale: 'y',
      },
    ]
    const detailWithPos = {
      ...baseShipment(),
      linkedPOs: [
        {
          id: 'po1',
          linkId: 'l1',
          poNumber: '1',
          itemStyleNo: 'A',
          quantity: null,
          totalQuantity: null,
          quantityUnit: null,
        } satisfies LinkedPO,
      ],
    }
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={detailWithPos as never}
          criticReview={baseReview({ conflicts })}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    const grid = screen.getByTestId('review-decision-grid')
    expect(within(grid).queryByText('Item / Style No.')).toBeNull()
    expect(within(grid).getByText('Total Quantity')).toBeInTheDocument()
  })
})

describe('qty live-leg settle on decision table', () => {
  it('hides qty conflict when live leg already matches AI proposed (GZL-class)', () => {
    const shipment = baseShipment({
      quantityShipped: 16,
      quantityUnit: 'cartons',
      linkedPOs: [
        {
          id: 'po1',
          linkId: 'l1',
          poNumber: '28739',
          quantity: 10,
          totalQuantity: null,
          quantityUnit: 'cartons',
          itemStyleNo: 'RED STRIPE',
        },
        {
          id: 'po2',
          linkId: 'l2',
          poNumber: '28740',
          quantity: 6,
          totalQuantity: null,
          quantityUnit: 'cartons',
          itemStyleNo: 'X',
        },
      ],
    } as never)
    const conflictQty: CriticConflict = {
      field: 'qty',
      label: 'Total Quantity',
      candidates: [
        { value: '5', source: 'system' },
        { value: '16', source: 'Final B/L' },
      ],
      rationale: 'stale system vs email',
    }
    const conflictVendor: CriticConflict = {
      field: 'vendor_code',
      label: 'Vendor',
      candidates: [
        { value: '', source: 'system' },
        { value: 'MACAU FUNG TAI LIMITED', source: 'SO' },
      ],
      rationale: 'vendor',
    }
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipment}
          criticReview={baseReview({ conflicts: [conflictQty, conflictVendor] })}
          compact={null}
          defaultExpanded
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    const grid = screen.getByTestId('review-decision-grid')
    expect(within(grid).queryByText('Total Quantity')).toBeNull()
    // Row label follows EDITABLE_FIELDS, which names the party fields by what they store (a code).
    expect(within(grid).getByText('Vendor Code')).toBeInTheDocument()
    // Qty settled — Approve must not double-count it as a second change. The label is now a plain
    // verb, so the count lives in the tooltip; assert there rather than losing the guard.
    expect(screen.getByRole('button', { name: /^approve$/i })).toHaveAttribute(
      'title',
      'Apply 1 change and confirm',
    )
  })

  it('still shows qty when live differs from all non-system candidates', () => {
    const shipment = baseShipment({
      quantityShipped: 16,
      quantityUnit: 'cartons',
      linkedPOs: [],
    } as never)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipment}
          criticReview={baseReview({
            conflicts: [
              {
                field: 'qty',
                label: 'Total Quantity',
                candidates: [
                  { value: '5', source: 'system' },
                  { value: '100', source: 'SO' },
                ],
                rationale: 'real fight',
              },
            ],
          })}
          compact={null}
          defaultExpanded
        />
      </MemoryRouter>,
    )
    const grid = screen.getByTestId('review-decision-grid')
    expect(within(grid).getByText('Total Quantity')).toBeInTheDocument()
    // Current column shows live leg qty, not stale system candidate
    expect(within(grid).getByText('16')).toBeInTheDocument()
  })
})

/** Detail-shaped keys for critical sailing fields (crd / etd / actualDeparture). */
function shipmentWithCriticals(over: Record<string, unknown> = {}): ReviewShipment {
  return {
    ...baseShipment({
      bookingNo: 'BY058417',
      soNo: 'SO-99',
      reviewReasons: [],
    }),
    crd: '2026-08-01',
    etd: '2026-08-10',
    actualDeparture: '2026-08-11',
    ...over,
  } as ReviewShipment
}

describe('decision desk — ready state (no Critical for sailing band)', () => {
  it('does not show Critical for sailing when booking blank', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipmentWithCriticals({ bookingNo: null })}
          criticReview={baseReview({ conflicts: [], riskFlags: [], reasons: [] })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('critical-sailing')).toBeNull()
    expect(screen.queryByText(/Critical for sailing/i)).toBeNull()
    expect(screen.queryByTestId('critical-approve-soft-warn')).toBeNull()
  })

  it('shows ready banner when no needs-attention and no conflicts', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipmentWithCriticals()}
          criticReview={baseReview({ conflicts: [], riskFlags: [], reasons: [] })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('needs-attention')).toBeNull()
    expect(screen.getByTestId('review-ready-state')).toHaveTextContent(
      /ready to confirm|no open decisions/i,
    )
  })

  it('shows judgment-only line when only needs-attention (no conflicts)', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipmentWithCriticals()}
          criticReview={baseReview({
            conflicts: [],
            riskFlags: [
              {
                code: 'WEAK_IDENTITY',
                severity: 'medium',
                message:
                  'No strong booking/SO/B/L identity and no PO — hard to place this email on a shipment.',
              },
            ],
            reasons: [],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('needs-attention')).toBeInTheDocument()
    expect(screen.getByTestId('review-judgment-only')).toHaveTextContent(
      /No field changes|confirm when verified/i,
    )
  })
})
