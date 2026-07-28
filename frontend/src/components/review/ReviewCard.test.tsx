import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    // Multi-candidate HBL: every stated value visible in "Also seen" (not buried in a datalist)
    expect(within(table).getByText('SE26061400005')).toBeInTheDocument()
    expect(within(table).getByText('SE26061400006')).toBeInTheDocument()
    expect(within(table).getByTestId('multi-candidate-proposed')).toBeInTheDocument()
    // Column headers — default view shows agent proposals; Resolution/Edited only after Edit / changes.
    expect(within(table).getByText('Current')).toBeInTheDocument()
    expect(within(table).getByTestId('proposed-column-header')).toHaveTextContent('Also seen')
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
    // The group title ("Real Shipment?") is now the HEADLINE, phrased as the question being asked.
    expect(screen.getByTestId('desk-question')).toHaveTextContent(
      /Which shipment does this email belong to\?/i,
    )
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
    // The TABLE owns the headline whenever it has rows — its conflict-class needs-attention lines are
    // suppressed exactly then, so anything else on the leg would otherwise inherit the title.
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Which values are correct\?/i)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(/2 fields disagree/i)
    // The which-shipment line is not lost — it follows under "Also".
    expect(
      within(screen.getByTestId('needs-attention-rest')).getByText(
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
    // Was the "Fields Disagree" group title; the same idea is now the headline, as a question.
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Which values are correct\?/i)
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
    // The field fight leads (it is the sharper question); the NAMED master miss follows under "Also"
    // — still on the Review desk, because ops can add exactly that company in Mesh.
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Which values are correct\?/i)
    const rest = screen.getByTestId('needs-attention-rest')
    expect(within(rest).getByText(/A\.P\. Moller - Maersk|Mesh Database/i)).toBeInTheDocument()
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
    // One line survives the dedup, so it is the headline's subtext — and there is no "Also" list,
    // which is what "does not repeat" means now that a single line no longer renders as a bullet.
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Is the cargo complete\?/i)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(
      /Email says there is an attachment, but none was received — cargo may be incomplete/,
    )
    expect(screen.queryByTestId('needs-attention-rest')).toBeNull()
    expect(within(screen.getByTestId('why-review')).queryAllByRole('listitem')).toHaveLength(0)
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
    // One contested row → the headline names THAT field. The PO-only/thin line moves under "Also",
    // where it keeps the leg's Not-a-Shipment escape without titling a card about a Qty decision.
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/^Which .+ is correct\?$/i)
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
    const resolution = screen.getByTestId('datetime-date') as HTMLInputElement
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
    // A day-only pick carries T00:00 — the local-midnight form DateTimeField emits and the Order
    // Details form has always sent. A bare '2026-07-25' would reach `new Date()` on the backend as
    // UTC midnight, i.e. 08:00 in the pinned HK zone.
    expect(payload.fields).toMatchObject({ eta: '2026-07-25T00:00' })
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
      /* The evidence panel fetches the body + attachments, so this render needs a query client. */
      <QueryClientProvider client={new QueryClient()}>
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
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // one icon: the known email. The unmatched candidate and the System side get none.
    const icons = screen.getAllByTestId('candidate-source-email')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveAttribute('title', 'Show where this came from — SO for GZL')

    // Opens INSIDE the card now. It used to launch a chrome-less pop-up, which meant leaving the card
    // to read the mail and carrying the value back in your head.
    await user.click(icons[0]!)
    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
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
    // unresolved → the prompt is there, headlined by the question it asks
    expect(screen.getByTestId('needs-attention')).toBeInTheDocument()
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Is this the right shipment\?/i)

    rerender(<ReviewCard {...props} readOnly />)
    expect(screen.queryByTestId('needs-attention')).toBeNull()
    expect(screen.queryByTestId('desk-question')).toBeNull()
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
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('Also seen')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('Resolution')
    expect((screen.getByTestId('datetime-date') as HTMLInputElement).value).toBe('2026-07-23')
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
    const eta = screen.getByTestId('datetime-date')
    await user.clear(eta)
    await user.type(eta, '2026-07-25')
    // mid-edit the column reads Resolution
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('Resolution')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    // discarded → back to the agent's proposal, not a lingering "Edited" state
    expect(screen.getByTestId('proposed-column-header')).toHaveTextContent('Also seen')
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
    expect(screen.getByRole('button', { name: /^keep current$/i })).toBeInTheDocument()
    // The primary now NAMES the value it writes rather than saying "Approve".
    expect(screen.getByRole('button', { name: /^apply 2026-07-23$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    // editing — only the two ways out
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^submit$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /keep current/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^apply 2026-07-23$/i })).toBeNull()
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
    const approve = screen.getByRole('button', { name: /^apply 2026-07-23$/i })
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
    const eta = screen.getByTestId('datetime-date')
    await user.clear(eta)
    await user.type(eta, '2026-07-25')

    // still in edit mode → the primary button is Submit
    const approve = screen.getByRole('button', { name: /^submit$/i })
    expect(approve).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Carrier confirmed the 25th')
    expect(approve).not.toBeDisabled()

    await user.click(approve)
    expect(onSave.mock.calls[0][0].corrections).toEqual([
      { field: 'eta', existing: '2026-07-20', aiProposed: '2026-07-23', humanFinal: '2026-07-25T00:00' },
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
    // Two contested rows → no single value to name, so the count carries it.
    expect(screen.getByRole('button', { name: /^apply 2 changes$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep all current/i })).toBeInTheDocument()
    // Not shipment is Documents-only (unlinked docs). Review queue has no dismiss path.
    expect(screen.queryByRole('button', { name: /not shipment/i })).toBeNull()
  })

  it('Keep current marks reviewed without writing anything', async () => {
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

  it('keeps linked POs off the grid when the open questions are field conflicts, not POs', () => {
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
    // The grid renders for the ETA/HBL fights; the PO block is gated separately and stays out.
    expect(screen.getByTestId('review-decision-grid')).toBeInTheDocument()
    expect(screen.queryByText(/POs & styles/i)).toBeNull()
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
    // 'MACAU FUNG TAI LIMITED' is too long to print in a button, so the count carries it; the title
    // still spells out what the click does.
    expect(screen.getByRole('button', { name: /^apply 1 change$/i })).toHaveAttribute(
      'title',
      'Apply 1 change — the leg leaves the desk',
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

  it('files the judgment-only line INSIDE the needs-attention panel, not loose in the card', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipmentWithCriticals()}
          criticReview={baseReview({
            conflicts: [],
            riskFlags: [{ code: 'MULTI_ID', severity: 'low', message: 'Two strong IDs in one email' }],
            reasons: [],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    const panel = screen.getByTestId('needs-attention')
    expect(within(panel).getByTestId('review-judgment-only')).toBeInTheDocument()
  })

  it('names the nothing-to-change confirmation for what it is', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={shipmentWithCriticals()}
          criticReview={baseReview({
            conflicts: [],
            riskFlags: [{ code: 'MULTI_ID', severity: 'low', message: 'Two strong IDs in one email' }],
            reasons: [],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    // Not "Keep Current" — nothing is being kept over an alternative, there is no alternative.
    expect(screen.getByRole('button', { name: /mark reviewed — no changes/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep current/i })).toBeNull()
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

/** The card half of the WHISTLES fix: it only trusts a slot that carries a master ID. */
describe('a resolved party stops the desk asking ops to add it', () => {
  const reason =
    'Cannot match "WHISTLES" in the customer list. Please add it in Cobalt Fashion Data Mesh System, then rematch.'

  function renderLeg(over: Record<string, unknown>) {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [reason], ...over } as never)}
          criticReview={baseReview({ conflicts: [], reasons: [], riskFlags: [] })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('the server says the customer resolved → the line is gone', () => {
    renderLeg({
      openDecisions: {
        settledFields: [],
        resolvedParties: [{ slot: 'customer', name: 'WHISTLES LIMITED' }],
      },
    })
    expect(screen.queryByText(/advise add in Mesh/i)).toBeNull()
    expect(screen.getByTestId('review-ready-state')).toBeInTheDocument()
  })

  /**
   * Only a real MASTER counts as resolved, and that judgement now lives in the backend mapper (it reads
   * the resolved master, never the raw stand-in). The card trusts that list and nothing else — a leg
   * carrying the name as free text does not silence the miss.
   */
  it('a raw name the server did not list is not a link', () => {
    renderLeg({ customer: 'WHISTLES LIMITED' })
    expect(screen.getByText(/advise add in Mesh/i)).toBeInTheDocument()
  })

  it('nothing resolved → the line stays', () => {
    renderLeg({})
    expect(screen.getByText(/advise add in Mesh/i)).toBeInTheDocument()
  })

  it('a DIFFERENT company resolving does not silence this miss', () => {
    renderLeg({
      openDecisions: {
        settledFields: [],
        resolvedParties: [{ slot: 'customer', name: 'LIGENTIA ASIA LTD' }],
      },
    })
    expect(screen.getByText(/advise add in Mesh/i)).toBeInTheDocument()
  })
})

/**
 * Leg E553C0A2 — one of the four legs D0 does not resolve, so the picker is genuinely needed. The
 * email gave only SO FENLSO003062, which matches none of the four offered; the card never said so, so
 * the `suggested` row read like an identity match when it was a guess from vessel and ETD.
 */
describe('when a pick IS needed, the question and the answer are adjacent', () => {
  const matchAmbiguity = {
    kind: 'multi_candidate' as const,
    emailKey: { so_no: 'FENLSO003062', customer_po: 'FENLSO003062' },
    suggestion: {
      shipmentId: 'c1',
      rationale: 'Matches PO in pos list and SO-like id FENLSO003044 relates; ETD close to email date',
      source: 'llm_rank' as const,
    },
    candidates: [
      { shipmentId: 'c1', jobNo: 'JOB-2026-0008', so_no: 'FENLSO003044', etd: '2026-08-04', matchedBy: 'po' as const },
      { shipmentId: 'c4', jobNo: 'JOB-2026-0011', so_no: 'FENLSO003045', etd: '2026-08-04', matchedBy: 'po' as const },
    ],
  }

  function renderPicker() {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [], soNumber: 'FENLSO003062' } as never)}
          criticReview={baseReview({
            conflicts: [],
            reasons: [],
            riskFlags: [{ code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'matched more than one leg' }],
            matchAmbiguity,
          } as never)}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onLink={vi.fn()}
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('the question is asked once — the panel no longer repeats it', () => {
    renderPicker()
    expect(screen.getByTestId('desk-question')).toHaveTextContent(
      /Which shipment does this email update\?/i,
    )
    expect(screen.getAllByText(/Which shipment does this email update\?/i)).toHaveLength(1)
  })

  it('the headline admits the email matches none of them', () => {
    renderPicker()
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(/matches none of these/i)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(/FENLSO003062/)
  })

  it('what they share is said once; each row carries only what differs', () => {
    renderPicker()
    const shared = screen.getByTestId('candidate-shared-line')
    expect(shared).toHaveTextContent(/ETD/)
    // No B/L, booking, MBL or container on any — that is why the pick cannot be made on identity.
    expect(shared).toHaveTextContent(/no HBL \/ BK \/ MBL \/ CTR on any/i)
    const titles = screen.getAllByTestId('candidate-biz-title').map((el) => el.textContent)
    expect(titles).toEqual(['SO FENLSO003044', 'SO FENLSO003045'])
  })

  it('the reason for the suggestion sits on the row it describes', () => {
    renderPicker()
    expect(screen.getByTestId('candidate-suggestion-reason')).toHaveTextContent(
      /ETD close to email date/i,
    )
  })

  it('the primary will not commit until a target is picked', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: /^link — /i })).toBeDisabled()
  })
})

/**
 * Legs DEEC1FC0 (`SO no.`) and 01B94D12 (`PORT OF LOADING`): a spreadsheet parsed with its header row
 * treated as data. Both provisional, both carrying four emails — so they are flagged for a human, not
 * auto-rejected. Quietly binning them would take the linked evidence with them.
 */
describe('a leg parsed out of a spreadsheet header row', () => {
  function renderHeaderLeg(so: string) {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [], soNumber: so, bookingNo: null } as never)}
          criticReview={baseReview({ conflicts: [], reasons: [], riskFlags: [] })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onReject={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('asks whether it is a shipment at all, and names the giveaway', () => {
    renderHeaderLeg('SO no.')
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Is this a real shipment\?/i)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(/SO no\./)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(/column heading|header row/i)
  })

  it('offers the verdict that answers it', () => {
    renderHeaderLeg('PORT OF LOADING')
    expect(screen.getByTestId('review-reject')).toHaveTextContent(/not a shipment/i)
  })

  it('a real SO number raises nothing — the card is simply ready to confirm', () => {
    renderHeaderLeg('FENLSO003044')
    expect(screen.queryByTestId('desk-question')).toBeNull()
    expect(screen.queryByTestId('review-reject')).toBeNull()
    expect(screen.getByTestId('review-ready-state')).toBeInTheDocument()
  })
})

/**
 * Phase ①: the queue offers candidates ShipTrack's committer would refuse — a different B/L is a
 * different shipment. 54 of 62 offered candidates were in that state, so the picker disappears on 12
 * of 13 legs. That must not be silent.
 */
describe('candidates the committer would refuse are explained, not silently dropped', () => {
  function renderRefused(refusedCandidates: unknown[], withPicker = false) {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [] })}
          criticReview={baseReview({
            conflicts: [],
            reasons: [],
            riskFlags: [],
            refusedCandidates,
            ...(withPicker
              ? {
                  matchAmbiguity: {
                    kind: 'multi_candidate',
                    candidates: [{ shipmentId: 'a' }, { shipmentId: 'b' }],
                  },
                }
              : {}),
          } as never)}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onLink={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('says how many were refused and on which identifier', () => {
    renderRefused([
      { shipmentId: 'x1', onKey: 'hbl_awb_fcr_no', emailValue: 'FCR001379073', candidateValue: 'FCR001378583' },
      { shipmentId: 'x2', onKey: 'hbl_awb_fcr_no', emailValue: 'FCR001379073', candidateValue: 'FCR001378650' },
    ])
    expect(screen.getByTestId('refused-candidates')).toHaveTextContent(
      /2 similar shipments matched, but they state a different B\/L — not offered/i,
    )
  })

  it('uses the operator’s word for the clashing key', () => {
    renderRefused([{ shipmentId: 'x1', onKey: 'booking_no', emailValue: 'BK-9', candidateValue: 'BK-8' }])
    expect(screen.getByTestId('refused-candidates')).toHaveTextContent(
      /1 similar shipment matched, but it states a different booking number/i,
    )
  })

  /** With a picker still up the panel speaks for itself; the note would be a second voice. */
  it('stays quiet while a picker is still shown', () => {
    renderRefused([{ shipmentId: 'x1', onKey: 'hbl_awb_fcr_no', emailValue: 'A', candidateValue: 'B' }], true)
    expect(screen.queryByTestId('refused-candidates')).toBeNull()
  })

  it('nothing refused → no note', () => {
    renderRefused([])
    expect(screen.queryByTestId('refused-candidates')).toBeNull()
  })
})

/**
 * Identity is settled by what the COMMITTER did, never by comparing the email's key to the leg's.
 *
 * The earlier rule did exactly that and was circular: when the committer CREATES a leg from an email,
 * the leg carries that email's HBL *because this email wrote it*. It was true for every created leg,
 * proved nothing, and hid the picker on the 179-of-181 population where the question is real.
 */
describe('the committer decides whether identity is settled', () => {
  const matchAmbiguity = {
    kind: 'multi_candidate' as const,
    emailKey: { so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379073' },
    candidates: [
      { shipmentId: '1A6B6478', jobNo: 'JOB-2026-0005', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001378583' },
      { shipmentId: 'B1F99BCB', jobNo: 'JOB-2026-0005', so_no: 'S13784413', hbl_awb_fcr_no: 'FCR001379050' },
    ],
  }

  function renderWithAction(committerAction: string | null) {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={
            baseShipment({
              reviewReasons: [],
              hblNumber: 'FCR001379073',
              soNumber: 'S13784413',
              committerAction,
            } as never)
          }
          criticReview={baseReview({
            conflicts: [],
            reasons: [],
            riskFlags: [
              { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'matched more than one existing leg' },
            ],
            matchAmbiguity,
          } as never)}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onLink={vi.fn()}
          onIdentify={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('matched → no picker, and the ready line says the committer settled it', () => {
    renderWithAction('matched')
    expect(screen.queryByTestId('candidate-legs-panel')).toBeNull()
    expect(screen.queryByTestId('identify-shipment')).toBeNull()
    expect(screen.getByTestId('review-ready-state')).toHaveTextContent(/committer matched it/i)
  })

  /**
   * The regression this whole change exists for. Same leg, same matching HBL — but the committer
   * CREATED it, so the HBL proves nothing and the picker must stay.
   */
  it('created_pending_dedup → the picker STAYS, even though the HBLs match', () => {
    renderWithAction('created_pending_dedup')
    expect(screen.getByTestId('candidate-legs-panel')).toBeInTheDocument()
  })

  it('…and it asks whether we duplicated, not which shipment to update', () => {
    renderWithAction('created_pending_dedup')
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Is this a duplicate/i)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(
      /A new shipment was created for this email while 2 similar ones already existed/i,
    )
  })

  /** Legs committed before 0027 have no record. Unknown is not "settled" — the picker stays. */
  it('a null action (pre-0027 leg) keeps the picker', () => {
    renderWithAction(null)
    expect(screen.getByTestId('candidate-legs-panel')).toBeInTheDocument()
  })

  it('adopted_zero_id also counts as settled — an existing leg absorbed the fields', () => {
    renderWithAction('adopted_zero_id')
    expect(screen.queryByTestId('candidate-legs-panel')).toBeNull()
  })

  it('an escape hatch brings the picker back', async () => {
    const user = userEvent.setup()
    renderWithAction('matched')
    await user.click(screen.getByTestId('review-pin-override'))
    expect(screen.getByTestId('candidate-legs-panel')).toBeInTheDocument()
  })
})

/**
 * The busiest card in the dev queue — leg A84B3B1A / SO S13784413, 6 conflicts, 7 risk flags, 10
 * reasons — had ZERO real field decisions: commit-first had already written every value the email
 * proposed, and the critic's "System" candidate was a snapshot from before that write. Measured across
 * the queue: 41 of 41 checkable rows were in that state.
 */
describe('rows the leg already satisfies leave the grid', () => {
  /** The backend now decides what is settled; the card reads its answer (openDecisions). */
  const realLeg = (over: Record<string, unknown> = {}) =>
    baseShipment({
      reviewReasons: [],
      openDecisions: {
        settledFields: ['vessel_name', 'voyage_no'],
        resolvedParties: [],
        liveValues: { vessel_name: 'MARIBO MAERSK', voyage_no: '631W' },
      },
      ...over,
    } as never)

  const realConflicts: CriticConflict[] = [
    {
      field: 'vessel_name',
      label: 'Vessel',
      candidates: [
        { value: 'MAASTRICHT MAERSK', source: 'System' },
        { value: 'MARIBO MAERSK', source: 'Draft B/L' },
      ],
      rationale: 'stale system snapshot',
    },
    {
      field: 'voyage_no',
      label: 'Voyage',
      candidates: [
        { value: '630W', source: 'System' },
        { value: '631W', source: 'Draft B/L' },
      ],
      rationale: 'stale system snapshot',
    },
  ] as CriticConflict[]

  it('no grid, no Apply — one line says the email got what it asked for', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={realLeg()}
          criticReview={baseReview({
            conflicts: realConflicts,
            reasons: [],
            riskFlags: [{ code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'matched more than one leg' }],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('review-decision-grid')).toBeNull()
    expect(screen.getByTestId('review-applied-conflicts')).toHaveTextContent(
      /2 fields the email proposed are already on the shipment/i,
    )
    // Nothing to apply → the primary answers the question that IS open, not a phantom diff.
    expect(screen.queryByRole('button', { name: /^apply/i })).toBeNull()
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Is this the right shipment\?/i)
  })

  /**
   * Regression, leg A84B3B1A: settling emptied the table, the "table owns the comparison" count fell
   * to 0, and the suppressed conflict prose came back — so the card said "6 field(s) disagree — see
   * conflict table" and "Email and system differ on Qty, Consignee Address, vessel, voyage" while a
   * green line beside it said those fields already agreed, and no table existed to look at.
   */
  it('never points at a conflict table that settling removed', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={realLeg()}
          criticReview={baseReview({
            conflicts: realConflicts,
            reasons: [],
            riskFlags: [
              { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'matched more than one leg' },
              {
                code: 'INTRA_EMAIL_FIELD_CONFLICT',
                severity: 'high',
                message: '6 field conflicts — values disagree (see conflict table).',
              },
              {
                code: 'BACKEND_CONFLICT',
                severity: 'high',
                message:
                  'Email disagrees with what is already stored on Qty, Consignee Address, vessel, voyage — needs a human call.',
              },
            ],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('review-decision-grid')).toBeNull()
    const why = screen.getByTestId('why-review')
    expect(why.textContent).not.toMatch(/see conflict table/i)
    expect(why.textContent).not.toMatch(/field\(s\) disagree/i)
    expect(why.textContent).not.toMatch(/Email and system differ/i)
    // The accurate statement is the only one left standing.
    expect(screen.getByTestId('review-applied-conflicts')).toHaveTextContent(/already on the shipment/i)
  })

  it('counts a qty row the leg literally holds as applied, not as silently dropped', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({
            reviewReasons: [],
            quantityShipped: 784,
            openDecisions: {
              settledFields: ['qty', 'vessel_name'],
              resolvedParties: [],
              liveValues: { qty: '784', vessel_name: 'MARIBO MAERSK' },
            },
          } as never)}
          criticReview={baseReview({
            conflicts: [
              {
                field: 'qty',
                label: 'Total Quantity',
                candidates: [
                  { value: '369', source: 'System' },
                  { value: '784', source: 'Draft B/L' },
                ],
                rationale: 'stale system snapshot',
              } as CriticConflict,
              realConflicts[0]!,
            ],
            reasons: [],
            riskFlags: [],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    // Both are already stored — the qty settle used to swallow its row before it could be reported.
    expect(screen.getByTestId('review-applied-conflicts')).toHaveTextContent(/2 fields/i)
  })

  it('the settled rows open up so the operator can verify the claim', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={realLeg()}
          criticReview={baseReview({ conflicts: realConflicts, reasons: [], riskFlags: [] })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    const strip = screen.getByTestId('review-applied-conflicts')
    await user.click(within(strip).getByRole('button'))
    expect(within(strip).getByText('MARIBO MAERSK')).toBeInTheDocument()
    expect(within(strip).getByText('631W')).toBeInTheDocument()
  })

  /** One or two bare bullets read fine; four turn into a blob, so the group titles come back. */
  it('the Also list earns its group titles at three lines', () => {
    const many = () =>
      render(
        <MemoryRouter>
          <ReviewCard
            shipment={baseShipment({
              reviewReasons: [
                'Cannot match "A.P. Moller - Maersk" in the forwarder list. Please add it in Cobalt Fashion Data Mesh System, then rematch.',
                'no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment',
              ],
            })}
            criticReview={baseReview({
              conflicts: [],
              reasons: [],
              riskFlags: [
                { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'matched more than one leg' },
                { code: 'MISSING_ATTACHMENT', severity: 'high', message: 'references an attachment' },
              ],
            })}
            compact={null}
            defaultExpanded
            onApprove={vi.fn()}
          />
        </MemoryRouter>,
      )
    many()
    const rest = screen.getByTestId('needs-attention-rest')
    // At least one group title is printed now (the exact set depends on classification).
    const titles = ['Which Shipment?', 'Real Shipment?', 'Master Miss', 'Incomplete Data', 'Other']
    expect(titles.some((t) => rest.textContent?.includes(t))).toBe(true)
  })

  it('two lines stay bare — a title per bullet is pure nesting', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [] })}
          criticReview={baseReview({
            conflicts: [],
            reasons: [],
            riskFlags: [
              { code: 'AMBIGUOUS_MATCH', severity: 'high', message: 'matched more than one leg' },
              { code: 'MISSING_ATTACHMENT', severity: 'high', message: 'references an attachment' },
            ],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    // Headline takes one, so "Also" holds exactly one — well under the threshold.
    const rest = screen.getByTestId('needs-attention-rest')
    expect(rest.textContent).not.toMatch(/Incomplete Data|Which Shipment\?/)
  })

  it('a row that genuinely disagrees stays in the grid, and Current shows the LIVE value', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={realLeg({
            openDecisions: {
              settledFields: ['vessel_name'],
              resolvedParties: [],
              liveValues: { vessel_name: 'MARIBO MAERSK', voyage_no: '631W' },
            },
          })}
          criticReview={baseReview({
            conflicts: [
              realConflicts[0]!,
              {
                field: 'voyage_no',
                label: 'Voyage',
                candidates: [
                  { value: '630W', source: 'System' },
                  { value: '999X', source: 'Final B/L' },
                ],
                rationale: 'real disagreement',
              } as CriticConflict,
            ],
            reasons: [],
            riskFlags: [],
          })}
          compact={null}
          defaultExpanded
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    const grid = screen.getByTestId('review-decision-grid')
    expect(within(grid).getByText('Voyage')).toBeInTheDocument()
    expect(within(grid).queryByText('Vessel')).toBeNull()
    // Current used to print the critic's pre-write snapshot ('630W'); the leg says 631W.
    expect(within(grid).getByText('631W')).toBeInTheDocument()
    expect(within(grid).queryByText('630W')).toBeNull()
    expect(screen.getByTestId('review-applied-conflicts')).toHaveTextContent(/1 field/i)
  })
})

/**
 * A multi-candidate row is the whole decision, and it used to be inert: three dead <div>s plus
 * "3 candidates — pick one in Edit". The radios and their onChange already existed — the mode switch
 * was the only thing between the operator and an answer already fully described on screen.
 */
describe('candidate picking happens where the candidates are', () => {
  /** Vendor with three named candidates, one carrying a resolved master code. */
  const vendorConflict: CriticConflict = {
    field: 'vendor_code',
    label: 'Vendor',
    candidates: [
      { value: '', source: 'system' },
      { value: 'FENIX FASHION LIMITED', source: 'Draft BOL', master: { code: 'FEFALT' } },
      { value: 'SHANGHAI JINGQINGRONG GARMENT CO LTD', source: 'SO', master: { code: 'JINGQI' } },
      { value: 'SHANGHAI JINGRONG SCIENCE & TECHNOLOGY CO LTD', source: 'SO', master: { code: 'JINGSC' } },
    ],
    rationale: 'three co-current vendors in the thread',
  } as CriticConflict

  function renderVendor(over: { readOnly?: boolean } = {}) {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [] })}
          criticReview={baseReview({ conflicts: [vendorConflict], riskFlags: [], reasons: [] })}
          compact={null}
          defaultExpanded
          readOnly={over.readOnly}
          onApprove={vi.fn().mockResolvedValue(undefined)}
          onSaveAndApprove={vi.fn().mockResolvedValue(undefined)}
          onWait={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('candidates are radios without entering Edit, and the copy no longer sends you there', () => {
    renderVendor()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByText(/pick one in Edit/i)).toBeNull()
    expect(screen.getByTestId('candidate-type-custom')).toBeInTheDocument()
  })

  it('Edit disappears — every contested row is now operable in place', () => {
    renderVendor()
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
    // The one thing a cell cannot do still opens the editor.
    expect(screen.getByTestId('candidate-type-custom')).toBeInTheDocument()
  })

  it('the headline names the contested field, not whatever else is on the leg', () => {
    renderVendor()
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/Which Vendor Code is correct\?/i)
    expect(screen.getByTestId('desk-question-detail')).toHaveTextContent(/3 candidates from the email/i)
  })

  it('the primary names the master code it writes, and picking another changes it', async () => {
    const user = userEvent.setup()
    renderVendor()
    // Seeded with the agent's first candidate.
    expect(screen.getByRole('button', { name: /^apply FEFALT$/i })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /JINGQINGRONG/i }))
    expect(screen.getByRole('button', { name: /^apply JINGQI$/i })).toBeInTheDocument()
  })

  it('nothing stored → the decline button says Leave Blank, not Keep Current', () => {
    renderVendor()
    expect(screen.getByRole('button', { name: /^leave blank$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep current/i })).toBeNull()
  })

  it('a pick applies without a note — choosing a candidate is not an override', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [] })}
          criticReview={baseReview({ conflicts: [vendorConflict], riskFlags: [], reasons: [] })}
          compact={null}
          defaultExpanded
          onSaveAndApprove={onSave}
        />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('radio', { name: /JINGRONG SCIENCE/i }))
    await user.click(screen.getByRole('button', { name: /^apply JINGSC$/i }))
    expect(onSave).toHaveBeenCalledTimes(1)
    // vendor_code writes the editable raw twin (Mesh masters lag ~2 months); the picked master CODE is
    // what lands there, which is also what the button named.
    expect(onSave.mock.calls[0][0].fields).toMatchObject({ vendorRaw: 'JINGSC' })
    expect(onSave.mock.calls[0][0].note).toBe('')
  })

  it('resolved history keeps the list inert — no radios, no custom-value link', () => {
    renderVendor({ readOnly: true })
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByTestId('candidate-type-custom')).toBeNull()
    expect(screen.getByTestId('multi-candidate-proposed')).toBeInTheDocument()
  })

  /**
   * "Type a different value" is the escape hatch for ONE contested text field, but it turns on
   * card-wide edit mode — and the PO strip used to open on `canEditGrid` alone. So asking to type a
   * custom Consignee Name produced a PO editor (Add PO, unlink, delete style) on a card whose POs
   * nobody had questioned. The PO gate is now the same in both modes: a proposal, or nothing.
   */
  it('the custom-value escape hatch does not drag the PO editor onto a card with no PO question', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={
            baseShipment({
              reviewReasons: [],
              linkedPOs: [
                { id: 'po1', linkId: 'l1', poNumber: '28739', itemStyleNo: 'C198' },
              ],
            } as never)
          }
          criticReview={baseReview({ conflicts: [vendorConflict], riskFlags: [], reasons: [] })}
          compact={null}
          defaultExpanded
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
    await user.click(screen.getByTestId('candidate-type-custom'))
    // The card IS in edit mode — the contested row now takes a typed value.
    expect(screen.getByLabelText(/Proposed value for Vendor/i)).toBeInTheDocument()
    // …and the POs stayed on the shipment page where they belong.
    expect(screen.queryByTestId('review-po-styles-section')).toBeNull()
    expect(screen.queryByTestId('review-po-add')).toBeNull()
    expect(screen.queryByText('28739')).toBeNull()
  })
})

/**
 * The verdict buttons are worded as answers to the headline. Before this, a card asking "verify it
 * belongs in tracking" offered only `Edit` / `Confirm Reviewed` — the answer "it doesn't belong" had
 * no button anywhere on the screen, and no button named the question it settled.
 */
describe('verdicts answer the headline question', () => {
  /** Thin mail arrives as a committer reviewReason (r-thin), not as a queue risk flag. */
  const THIN_REASON =
    'no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment'
  const thinMail = () => baseReview({ conflicts: [], reasons: [], riskFlags: [] })

  function renderVerdicts(over: { onReject?: () => Promise<void>; onWait?: () => Promise<void> } = {}) {
    return render(
      <MemoryRouter>
        <ReviewCard
          /* Actually thin: no identifier, no route. A leg WITH a booking number and a route is a
             shipment whatever the reason text says, and now takes the working shape instead — see
             "the card takes its shape from the leg". */
          shipment={baseShipment({ reviewReasons: [THIN_REASON], bookingNo: null, route: null })}
          criticReview={thinMail()}
          compact={null}
          defaultExpanded
          onApprove={vi.fn().mockResolvedValue(undefined)}
          onReject={over.onReject}
          onWait={over.onWait}
        />
      </MemoryRouter>,
    )
  }

  it('the affirmative button answers the question instead of saying "Confirm Reviewed"', () => {
    renderVerdicts()
    expect(screen.getByRole('button', { name: /track it/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep current/i })).toBeNull()
  })

  it('Reject is worded by the question and passes the note as the reason', async () => {
    const user = userEvent.setup()
    const onReject = vi.fn().mockResolvedValue(undefined)
    renderVerdicts({ onReject })
    await user.click(screen.getByTestId('review-note-add'))
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'portal echo, no cargo')
    const btn = screen.getByTestId('review-reject')
    expect(btn).toHaveTextContent(/Not a Shipment/i)
    await user.click(btn)
    expect(onReject).toHaveBeenCalledWith('portal echo, no cargo')
  })

  it('Waiting parks it and carries the note as what is being waited on', async () => {
    const user = userEvent.setup()
    const onWait = vi.fn().mockResolvedValue(undefined)
    renderVerdicts({ onWait })
    await user.click(screen.getByTestId('review-note-add'))
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'asked QueenWong')
    await user.click(screen.getByTestId('review-wait'))
    expect(onWait).toHaveBeenCalledWith('asked QueenWong')
  })

  it('no note typed → the reason is omitted, not sent as an empty string', async () => {
    const user = userEvent.setup()
    const onWait = vi.fn().mockResolvedValue(undefined)
    renderVerdicts({ onWait })
    await user.click(screen.getByTestId('review-wait'))
    expect(onWait).toHaveBeenCalledWith(undefined)
  })

  it('no Reject button when rejecting does not answer the question', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [] })}
          criticReview={baseReview({
            conflicts: [],
            reasons: [],
            riskFlags: [{ code: 'AMBIGUOUS_MATCH', severity: 'medium', message: 'two legs match' }],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onReject={vi.fn()}
          onWait={vi.fn()}
        />
      </MemoryRouter>,
    )
    // "Is this the right shipment?" is answered by linking it, not by binning it.
    expect(screen.queryByTestId('review-reject')).toBeNull()
    // Parking is always available — you can always need to go and ask.
    expect(screen.getByTestId('review-wait')).toBeInTheDocument()
  })

  it('read-only history offers no verdicts at all', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment({ reviewReasons: [THIN_REASON] })}
          criticReview={thinMail()}
          compact={null}
          defaultExpanded
          readOnly
        />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('review-reject')).toBeNull()
    expect(screen.queryByTestId('review-wait')).toBeNull()
  })
})

/**
 * A PO only belongs on the decision desk when there is something to DECIDE about it. The grid used
 * to render for every linked PO, so a leg queued for an unrelated reason (a Mesh party miss) still
 * showed a four-column decision table over one PO with all three decision columns empty.
 */
describe('POs on the decision desk — only when a PO needs a decision', () => {
  const linkedPO: LinkedPO = {
    id: 'po1',
    linkId: 'l1',
    poNumber: '224340',
    quantity: null,
    totalQuantity: null,
    quantityUnit: null,
    itemStyleNo: '26-HMIGHLE-0294-1',
  }

  /** Party-miss leg with one PO and no field conflicts — the screenshot case. */
  function renderPoCard(
    over: { reviewReasons?: string[]; riskFlags?: CriticReview['riskFlags'] } = {},
  ) {
    return render(
      <MemoryRouter>
        <ReviewCard
          shipment={
            baseShipment({
              linkedPOs: [linkedPO],
              reviewReasons: over.reviewReasons ?? [],
            } as never)
          }
          criticReview={baseReview({
            conflicts: [],
            reasons: [],
            riskFlags: over.riskFlags ?? [
              {
                code: 'PARTY_OPS',
                severity: 'medium',
                message: 'Cannot match "CIL PLUS LIMITED" in the customer list',
              },
            ],
          })}
          compact={null}
          defaultExpanded
          onApprove={vi.fn()}
          onSaveAndApprove={vi.fn()}
        />
      </MemoryRouter>,
    )
  }

  it('nothing proposed for the PO → the PO leaves the desk entirely', () => {
    renderPoCard()
    expect(screen.queryByTestId('review-po-styles-section')).toBeNull()
    // Not a summary line either — no heading, no PO number, no styles anywhere on the card.
    expect(screen.queryByText(/POs & styles/i)).toBeNull()
    expect(screen.queryByText('224340')).toBeNull()
    expect(screen.queryByText('26-HMIGHLE-0294-1')).toBeNull()
    // No conflicts either → the whole decision grid is gone, not just the PO block.
    expect(screen.queryByTestId('review-decision-grid')).toBeNull()
  })

  it('a proposed item/style for the PO brings the grid back', () => {
    renderPoCard({
      reviewReasons: ['PO 224340: item/style "OLD" vs "NEW" (kept 26-HMIGHLE-0294-2)'],
    })
    expect(screen.getByTestId('review-po-styles-section')).toBeInTheDocument()
    expect(screen.getByText('26-HMIGHLE-0294-2')).toBeInTheDocument()
  })

  /**
   * Reversed 2026-07-27. A PO-LINK question used to open the PO grid, which answered it with a table
   * of Item/Style columns — every row `—`, and a style editor says nothing about which shipment a PO
   * belongs on. That question is now answered above the grid by SharedPoPanel, which names the other
   * leg and links to it, so the styles table has no reason to appear for it.
   */
  it('a PO-link question does NOT open the style grid — it is not what that question asks', () => {
    renderPoCard({
      riskFlags: [
        {
          code: 'PO_ONLY_WEAK_MATCH',
          severity: 'medium',
          message: 'Matched an existing shipment on PO alone',
        },
      ],
    })
    expect(screen.queryByTestId('review-po-styles-section')).toBeNull()
    // and the question itself is still put to the operator
    expect(screen.getByTestId('needs-attention')).toBeInTheDocument()
  })

  /**
   * Edit follows the same rule as the grid it opens: it is for legs with something editable. A leg
   * whose only open question is "is this freight at all?" has nothing to edit here — its POs are the
   * shipment page's business, reachable via Open Shipment.
   */
  it('no Edit button when there is nothing editable on the desk', () => {
    renderPoCard()
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
  })

  it('Edit returns — and opens the full grid — once a PO has a proposal to settle', async () => {
    const user = userEvent.setup()
    renderPoCard({
      reviewReasons: ['PO 224340: item/style "OLD" vs "NEW" (kept 26-HMIGHLE-0294-2)'],
    })
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByTestId('review-po-styles-section')).toBeInTheDocument()
    expect(screen.getByTestId('review-po-add')).toBeInTheDocument()
  })

  it('the note stays collapsed until it is asked for', async () => {
    const user = userEvent.setup()
    renderPoCard()
    expect(screen.queryByRole('textbox', { name: /note/i })).toBeNull()
    await user.click(screen.getByTestId('review-note-add'))
    expect(screen.getByRole('textbox', { name: /note/i })).toBeInTheDocument()
    expect(screen.queryByTestId('review-note-add')).toBeNull()
  })
})

/**
 * Leg 202601AEA6: Vendor Code stored MACFUN, the email agreed, and the card still offered
 * "Leave Blank" beside "Apply MACFUN" under a "Shipping (1 change)" heading.
 *
 * Cause: the Current cell printed `openDecisions.liveValues` ("(on shipment)") while every decision
 * read the critic's `System` candidate. cobalt-queue emits a System candidate ONLY for
 * backendMismatches, so a party row carries none — `'MACFUN' !== ''` counted as a change, and
 * `keepMeansBlank` believed the field was empty. Both sides now read currentValueOf().
 */
describe('Current is one value — the cell and the buttons cannot disagree', () => {
  const vendorNoSystemCandidate: CriticConflict = {
    field: 'vendor_code',
    label: 'Vendor Code',
    candidates: [
      {
        value: 'MACAU FUNG TAI LIMITED',
        source: 'Booking Request',
        master: { code: 'MACFUN', name: 'MACAU FUNG TAI LIMITED' },
      },
    ],
    rationale: 'Vendor named in the booking request.',
  }

  function renderVendorLeg(liveValues: Record<string, string>) {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ReviewCard
            shipment={
              {
                ...baseShipment({ reviewReasons: [] }),
                openDecisions: { settledFields: [], resolvedParties: [], liveValues },
              } as unknown as ReviewShipment
            }
            criticReview={baseReview({ conflicts: [vendorNoSystemCandidate] })}
            defaultExpanded
            embedded
            onApprove={vi.fn()}
            onSaveAndApprove={vi.fn()}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  }

  it('a stored value with no System candidate is never offered as blank', () => {
    renderVendorLeg({ vendor_code: 'MACFUN' })
    expect(screen.queryByRole('button', { name: /leave blank/i })).toBeNull()
  })

  it('proposing the value already stored is not a change — the desk has nothing to apply', () => {
    renderVendorLeg({ vendor_code: 'MACFUN' })
    // No "Apply MACFUN" / "Apply 1 Change", and no "Keep Current" either: with no alternative on
    // offer there is nothing to keep it OVER, so the card falls back to a plain confirmation.
    expect(screen.queryByRole('button', { name: /^apply/i })).toBeNull()
    expect(screen.getByRole('button', { name: /mark reviewed — no changes/i })).toHaveAttribute(
      'title',
      expect.stringContaining('nothing is written'),
    )
  })

  it('a genuinely different stored value still reads as a change', () => {
    renderVendorLeg({ vendor_code: 'SOUOCE' })
    expect(screen.getByRole('button', { name: /^apply/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^keep current$/i })).toBeInTheDocument()
  })

  /**
   * The grid's group header counted contested ROWS and called them changes, so leg 05F1BC19 announced
   * "Shipping (1 change)" directly above a button reading "there is nothing to change". Found by
   * walking the live queue after the accessor fix landed.
   */
  it('the group header counts what would be written, not how many rows are contested', () => {
    renderVendorLeg({ vendor_code: 'MACFUN' })
    const grid = screen.getByTestId('review-decision-grid')
    expect(grid).toHaveTextContent(/Shipping\s*\(nothing to apply\)/i)
    expect(grid).not.toHaveTextContent(/1 change/i)
  })

  it('and says "1 change" once a pick would actually write something', () => {
    renderVendorLeg({ vendor_code: 'SOUOCE' })
    expect(screen.getByTestId('review-decision-grid')).toHaveTextContent(/Shipping\s*\(1 change\)/i)
  })

  it('nothing stored anywhere still means Leave Blank', () => {
    renderVendorLeg({})
    expect(screen.getByRole('button', { name: /leave blank/i })).toBeInTheDocument()
  })
})

/**
 * Two card shapes (leg-shape.ts). A leg that plainly IS a shipment — identifier with digits, plus a
 * route/schedule — must never be asked whether it is freight, and must carry no reject: on a filled-in
 * card "Not a Shipment" is a destructive button answering a question nobody asked. A leg with too
 * little to be a shipment gets the verdict shape and NO field grid, because settling a vendor on
 * something that may not be freight is work thrown away.
 */
describe('the card takes its shape from the leg, not from the reason text', () => {
  const thinReason = 'no booking/SO/HBL identity and no lifecycle email type — verify this is a real shipment'

  function renderShape(over: Partial<ReviewShipment>, reasons: string[]) {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ReviewCard
            shipment={baseShipment({ reviewReasons: reasons, ...over })}
            criticReview={baseReview({ conflicts: [conflictEta], reasons })}
            defaultExpanded
            embedded
            onApprove={vi.fn()}
            onSaveAndApprove={vi.fn()}
            onReject={vi.fn()}
            onWait={vi.fn()}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    )
  }

  /** baseShipment already carries bookingNo BY058417 + route CNYTN→GBFXT — a real shipment. */
  it('a real-looking leg is never asked whether it is a shipment, even on a thin-mail reason', () => {
    renderShape({}, [thinReason])
    expect(screen.getByTestId('desk-question')).not.toHaveTextContent(/is this a real shipment/i)
    expect(screen.queryByTestId('review-reject')).toBeNull()
  })

  it('a real-looking leg keeps the grid and the field actions', () => {
    renderShape({}, [thinReason])
    expect(screen.getByTestId('review-decision-grid')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^keep current$/i })).toBeInTheDocument()
  })

  it('a header-row identifier forces the verdict shape whatever else it carries', () => {
    renderShape({ bookingNo: 'PO # :' }, [])
    expect(screen.getByTestId('desk-question')).toHaveTextContent(/is this a real shipment/i)
    expect(screen.getByTestId('review-reject')).toHaveTextContent(/not a shipment/i)
    // no grid: a leg named by a column heading cannot be filed under anything
    expect(screen.queryByTestId('review-decision-grid')).toBeNull()
  })

  it('a thin leg gets Not a Shipment · Track it · Waiting and no grid', () => {
    renderShape({ bookingNo: null, route: null }, [thinReason])
    expect(screen.getByTestId('review-reject')).toHaveTextContent(/not a shipment/i)
    expect(screen.getByRole('button', { name: /track it/i })).toBeInTheDocument()
    expect(screen.getByTestId('review-wait')).toBeInTheDocument()
    expect(screen.queryByTestId('review-decision-grid')).toBeNull()
  })

  /** The dangerous case: resolutions are still seeded, so a verdict click must not commit them. */
  it('a verdict card counts no changes, so Track it cannot apply values behind the operator', () => {
    renderShape({ bookingNo: null, route: null }, [thinReason])
    expect(screen.queryByRole('button', { name: /^apply/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
  })
})
