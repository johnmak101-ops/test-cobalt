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
    // OUR label, not the payload's bare 'HBL' — reviewFieldLabel prefers EDITABLE_FIELDS.
    expect(within(table).getByText('HBL / AWB / FCR No.')).toBeInTheDocument()
    // Column headers — the proposal is the agent's, and is the editable cell; Resolution is gone.
    expect(within(table).getByText('Existing')).toBeInTheDocument()
    expect(within(table).getByText('AI Proposed')).toBeInTheDocument()
    expect(within(table).queryByText('Resolution')).toBeNull()
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
    expect(within(why).getByText(/Real shipment\?/)).toBeInTheDocument()
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
    expect(screen.getByTestId('needs-group-which_shipment')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('needs-group-which_shipment')).getByText(
        /more than one booking\/SO\/B\/L number/,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  // #181: operators must see that only contested fields are in scope
  it('documents that Save applies contested conflict fields only', () => {
    render(
      <MemoryRouter>
        <ReviewCard
          shipment={baseShipment()}
          criticReview={baseReview()}
          compact={compact}
          defaultExpanded={true}
          fullShipmentPath="/shipments/leg-1"
        />
      </MemoryRouter>,
    )
    const hint = screen.getByTestId('review-edit-scope-hint')
    expect(hint.textContent).toMatch(/contested \(AI conflict\) fields/i)
    expect(within(hint).getByRole('link', { name: /Open full shipment/i })).toHaveAttribute(
      'href',
      '/shipments/leg-1',
    )
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
    expect(why.textContent).toMatch(/Email and system differ on qty, gross_weight — choose which values to keep/)
    expect(why.textContent).not.toMatch(/below|highlighted fields/)
    expect(why.textContent).toMatch(/Fields disagree/)
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
    // short conflict line + master miss (layman groups)
    expect(within(why).getByText(/Field values disagree|field\(s\) disagree/i)).toBeInTheDocument()
    expect(within(why).getByText(/Master miss/)).toBeInTheDocument()
    expect(within(why).getByText(/A\.P\. Moller - Maersk.*not in master|not in master.*A\.P\. Moller/i)).toBeInTheDocument()
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
    // Non-field context shown (all groups, no cap of 2)
    expect(within(why).getByText(/Linked by PO only — may be the wrong leg/)).toBeInTheDocument()
    expect(screen.getByTestId('needs-group-real_shipment')).toBeInTheDocument()
    expect(within(why).getByText(/Thin mail, not a lifecycle booking/)).toBeInTheDocument()
    expect(within(why).getByText(/not in master/i)).toBeInTheDocument()
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

    const saveBtn = screen.getByRole('button', { name: /approve 1 change/i })
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
    // Header link + #181 scope-hint link
    const links = screen.getAllByRole('link', { name: /open full shipment/i })
    expect(links.length).toBeGreaterThanOrEqual(1)
    expect(links.every((a) => a.getAttribute('href') === '/shipments/leg-1')).toBe(true)
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
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect((screen.getByLabelText(/proposed value for eta/i) as HTMLInputElement).value).toBe('2026-07-23')
    // hbl has NO system candidate and two proposals → first pre-fills, both stay reachable
    expect((screen.getByLabelText(/proposed value for hbl/i) as HTMLInputElement).value).toBe('SE26061400005')
    const options = Array.from(document.querySelectorAll('datalist option')).map((o) => o.getAttribute('value'))
    expect(options).toContain('SE26061400006')
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
    const approve = screen.getByRole('button', { name: /approve 1 change/i })
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

    const approve = screen.getByRole('button', { name: /approve 1 change/i })
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
          onDismiss={vi.fn()}
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
    expect(screen.getByRole('button', { name: /approve 2 changes/i })).toBeInTheDocument()
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
  const conflictGw: CriticConflict = {
    field: 'gross_weight',
    label: 'Gross weight',
    candidates: [{ value: '23', source: 'System' }, { value: '87', source: 'SO' }],
    rationale: '',
  }
  const conflictUom: CriticConflict = {
    field: 'qty_unit',
    label: 'UOM',
    candidates: [{ value: 'cartons', source: 'System' }, { value: 'pieces', source: 'Booking Request' }],
    rationale: 'Shipped in cartons, ordered in pieces.',
  }
  const withUom = (over = {}) => ({ ...baseShipment(over), quantityUnit: 'cartons' })

  it('renders the fixed unit on both sides of an invariant field', () => {
    render(
      <MemoryRouter>
        <ReviewCard shipment={withUom()} criticReview={baseReview({ conflicts: [conflictGw] })} compact={compact} defaultExpanded />
      </MemoryRouter>,
    )
    const row = screen.getByText('Gross Weight').closest('tr')!
    expect(within(row).getAllByText('KGS')).toHaveLength(2)
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
    expect(within(row).getByText('13516')).toBeInTheDocument()
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
})
