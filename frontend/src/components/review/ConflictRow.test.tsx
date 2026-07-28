import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConflictRow } from './ConflictRow'
import type { CriticConflict } from '../../lib/critic-review'

const baseConflict: CriticConflict = {
  field: 'etd',
  label: 'ETD',
  rationale: 'Dates differ',
  candidates: [
    { value: '2026-07-01', source: 'system' },
    { value: '2026-07-05', source: 'agent' },
  ],
}

function renderRow(overrides: { critical?: boolean; conflict?: CriticConflict } = {}) {
  return render(
    <table>
      <tbody>
        <ConflictRow
          conflict={overrides.conflict ?? baseConflict}
          value="2026-07-05"
          onChange={vi.fn()}
          editing={false}
          critical={overrides.critical}
        />
      </tbody>
    </table>,
  )
}

function renderPartyRow(conflict: CriticConflict, value: string) {
  return render(
    <table>
      <tbody>
        <ConflictRow conflict={conflict} value={value} onChange={vi.fn()} editing={false} />
      </tbody>
    </table>,
  )
}

describe('ConflictRow party master chips', () => {
  const vendorTwoCandidates: CriticConflict = {
    field: 'vendor_code',
    label: 'Vendor',
    candidates: [
      {
        value: 'SOUTH OCEAN KNITTERS LTD',
        source: 'Booking Request',
        master: { code: 'SOUOCE', name: 'SOUTH OCEAN KNITTERS LTD' },
      },
      {
        value: 'ROSE KNITTING FACTORY LIMITED',
        source: 'SO',
        master: { code: 'ROKNFT', name: 'ROSE KNITTING FACTORY LIMITED' },
      },
    ],
    rationale: 'Two vendor candidates from different emails.',
  }

  it('renders a code chip beside each resolved candidate name', () => {
    renderPartyRow(vendorTwoCandidates, 'SOUTH OCEAN KNITTERS LTD')
    const chips = screen.getAllByTestId('master-code-chip')
    expect(chips.map((c) => c.textContent)).toEqual(['SOUOCE', 'ROKNFT'])
    expect(screen.getByText('SOUTH OCEAN KNITTERS LTD')).toBeInTheDocument()
    expect(screen.getByText('ROSE KNITTING FACTORY LIMITED')).toBeInTheDocument()
  })

  it('#360: picking a resolved candidate posts the master CODE, and the typing field stays blank', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <table>
        <tbody>
          <ConflictRow
            conflict={vendorTwoCandidates}
            value="SOUOCE"
            onChange={onChange}
            editing
            canEdit
          />
        </tbody>
      </table>,
    )
    // the current value is the FIRST candidate's code — its radio reads selected
    expect(
      screen.getByLabelText('Select proposed candidate: SOUTH OCEAN KNITTERS LTD'),
    ).toBeChecked()
    // the free-typing input is blank while a candidate pick is active
    expect(screen.getByLabelText('Proposed value for Vendor Code')).toHaveValue('')
    // picking the other candidate posts ITS code, never the company full name
    await user.click(screen.getByLabelText('Select proposed candidate: ROSE KNITTING FACTORY LIMITED'))
    expect(onChange).toHaveBeenCalledWith('ROKNFT')
    expect(onChange).not.toHaveBeenCalledWith('ROSE KNITTING FACTORY LIMITED')
  })

  it('renders a "not in Mesh" tag when the candidate has master: null', () => {
    const conflict: CriticConflict = {
      field: 'vendor_code',
      label: 'Vendor',
      candidates: [
        { value: 'GOLDEN SUN KNITTING FTY LTD', source: 'SO', master: null },
        {
          value: 'ROSE KNITTING FACTORY LIMITED',
          source: 'SO',
          master: { code: 'ROKNFT', name: 'ROSE KNITTING FACTORY LIMITED' },
        },
      ],
      rationale: 'r',
    }
    renderPartyRow(conflict, 'GOLDEN SUN KNITTING FTY LTD')
    expect(screen.getByTestId('mesh-miss-tag')).toHaveTextContent('not in Mesh')
    expect(screen.getAllByTestId('master-code-chip')).toHaveLength(1)
  })

  it('renders neither chip nor tag when master is absent (non-party fields)', () => {
    const conflict: CriticConflict = {
      field: 'hbl_awb_fcr_no',
      label: 'HBL',
      candidates: [
        { value: 'SE26061400005', source: 'Final B/L' },
        { value: 'SE26061400006', source: 'Draft B/L' },
      ],
      rationale: 'r',
    }
    renderPartyRow(conflict, 'SE26061400005')
    expect(screen.queryByTestId('master-code-chip')).toBeNull()
    expect(screen.queryByTestId('mesh-miss-tag')).toBeNull()
  })

  it('renders the chip on the Current (System) side too', () => {
    const conflict: CriticConflict = {
      field: 'customer_code',
      label: 'Customer',
      candidates: [
        {
          value: 'WYSE LONDON LIMITED',
          source: 'System',
          master: { code: 'WYSE', name: 'WYSE LONDON LIMITED' },
        },
        {
          value: 'MACAU FUNG TAI LIMITED',
          source: 'SO',
          master: { code: 'MACFUN', name: 'MACAU FUNG TAI LIMITED' },
        },
      ],
      rationale: 'r',
    }
    const { container } = renderPartyRow(conflict, 'MACAU FUNG TAI LIMITED')
    // td[0] is the field label — td[1] is the Current column.
    const currentCell = container.querySelectorAll('td')[1] as HTMLElement
    expect(within(currentCell).getByTestId('master-code-chip')).toHaveTextContent('WYSE')
  })

  it('renders the chip for a single proposed candidate (non-multi branch)', () => {
    const conflict: CriticConflict = {
      field: 'vendor_code',
      label: 'Vendor',
      candidates: [
        {
          value: 'SOUTH OCEAN KNITTERS LTD',
          source: 'Booking Request',
          master: { code: 'SOUOCE', name: 'SOUTH OCEAN KNITTERS LTD' },
        },
      ],
      rationale: 'r',
    }
    renderPartyRow(conflict, 'SOUTH OCEAN KNITTERS LTD')
    expect(screen.getByTestId('master-code-chip')).toHaveTextContent('SOUOCE')
  })
})

/**
 * The row opens holding what the leg stores, so the email's value needs a way in that is not
 * "retype it in Edit". What the tick POSTS is the whole risk: a grouped "1,240" reaches
 * `coerceLegField` as NaN and clears the column, and a party name that resolved must post its code.
 */
describe('ConflictRow take-tick — what one click actually posts', () => {
  const renderTake = (conflict: CriticConflict, value: string, onChange: () => void, live?: string) =>
    render(
      <table>
        <tbody>
          <ConflictRow
            conflict={conflict}
            value={value}
            onChange={onChange}
            editing={false}
            canEdit
            existingOverride={live ?? null}
          />
        </tbody>
      </table>,
    )

  it('posts the un-grouped number, never the packing list’s "1,240"', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const qty: CriticConflict = {
      field: 'qty',
      label: 'Quantity',
      rationale: 'Counts differ',
      candidates: [
        { value: '1180', source: 'system' },
        { value: '1,240', source: 'Packing List' },
      ],
    }
    renderTake(qty, '1180', onChange)
    // It still READS as a grouped number — display groups, the decision does not. Slate while
    // untaken: seen in the email, not written by the committer.
    expect(screen.getByText('1,240')).toHaveClass('text-review-seen')
    await user.click(screen.getByTestId('conflict-take'))
    expect(onChange).toHaveBeenCalledWith('1240')
  })

  it('posts the master CODE for a resolved party, and the stored value back when un-ticked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const vendor: CriticConflict = {
      field: 'vendor_code',
      label: 'Vendor',
      rationale: 'Booking request names another factory',
      candidates: [
        {
          value: 'MACAU FUNG TAI LIMITED',
          source: 'Booking Request',
          master: { code: 'MACFUN', name: 'MACAU FUNG TAI LIMITED' },
        },
      ],
    }
    const { unmount } = renderTake(vendor, 'SOUOCE', onChange, 'SOUOCE')
    await user.click(screen.getByTestId('conflict-take'))
    expect(onChange).toHaveBeenCalledWith('MACFUN')
    unmount()

    // Ticked state → the box is the way back to what the leg holds.
    renderTake(vendor, 'MACFUN', onChange, 'SOUOCE')
    expect(screen.getByTestId('conflict-take')).toBeChecked()
    await user.click(screen.getByTestId('conflict-take'))
    expect(onChange).toHaveBeenLastCalledWith('SOUOCE')
  })

  it('day-forms an ISO instant on both the display and the value it hands back', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const eta: CriticConflict = {
      field: 'eta',
      label: 'ETA',
      rationale: 'SO states a later arrival',
      candidates: [{ value: '2026-09-09', source: 'SO' }],
    }
    renderTake(eta, '2026-09-05', onChange, '2026-09-05T00:00:00.000Z')
    expect(screen.getByText('2026-09-05')).toBeInTheDocument()
    expect(screen.queryByText('2026-09-05T00:00:00.000Z')).toBeNull()
    await user.click(screen.getByTestId('conflict-take'))
    expect(onChange).toHaveBeenCalledWith('2026-09-09')
  })

  it('resolved history has no tick — nothing there is a decision', () => {
    const eta: CriticConflict = {
      field: 'eta',
      label: 'ETA',
      rationale: 'r',
      candidates: [
        { value: '2026-09-05', source: 'system' },
        { value: '2026-09-09', source: 'SO' },
      ],
    }
    render(
      <table>
        <tbody>
          <ConflictRow conflict={eta} value="2026-09-05" onChange={vi.fn()} editing={false} />
        </tbody>
      </table>,
    )
    expect(screen.queryByTestId('conflict-take')).toBeNull()
  })
})

/**
 * Reported from the running desk: UOM took free text here and a `<select>` everywhere else, so
 * `cartonssdfsdf` was reachable from the review row and nowhere else in the app.
 */
describe('ConflictRow enum columns — the same select the edit form renders', () => {
  const uom: CriticConflict = {
    field: 'qty_unit',
    label: 'UOM',
    rationale: 'One email counts cartons, another pieces',
    candidates: [
      { value: 'cartons', source: 'system' },
      { value: 'pieces', source: 'Packing List' },
    ],
  }

  it('offers a dropdown, not a text box', () => {
    render(
      <table>
        <tbody>
          <ConflictRow conflict={uom} value="cartons" onChange={vi.fn()} editing canEdit />
        </tbody>
      </table>,
    )
    const control = screen.getByLabelText('Proposed value for UOM')
    expect(control.tagName).toBe('SELECT')
    const values = [...(control as HTMLSelectElement).options].map((o) => o.value)
    // Every legal unit, plus an empty option — clearing is a real answer a select must be able
    // to express.
    expect(values).toContain('')
    expect(values).toContain('cartons')
    expect(values).toContain('pieces')
  })

  it('keeps a stored value the offer list does not carry', () => {
    const odd: CriticConflict = {
      ...uom,
      candidates: [
        { value: 'BALES', source: 'system' },
        { value: 'pieces', source: 'Packing List' },
      ],
    }
    render(
      <table>
        <tbody>
          <ConflictRow conflict={odd} value="BALES" onChange={vi.fn()} editing canEdit />
        </tbody>
      </table>,
    )
    const control = screen.getByLabelText('Proposed value for UOM') as HTMLSelectElement
    // Opening the dropdown must not be able to silently rewrite what the leg holds.
    expect([...control.options].map((o) => o.value)).toContain('BALES')
    expect(control.value).toBe('BALES')
  })

  it('a free-text column is still a text box', () => {
    const vessel: CriticConflict = {
      field: 'vessel_name',
      label: 'Vessel',
      rationale: 'x',
      candidates: [
        { value: 'EVER GLORY', source: 'system' },
        { value: 'EVER GIVEN', source: 'Draft B/L' },
      ],
    }
    render(
      <table>
        <tbody>
          <ConflictRow conflict={vessel} value="EVER GIVEN" onChange={vi.fn()} editing canEdit />
        </tbody>
      </table>,
    )
    expect(screen.getByLabelText('Proposed value for Vessel').tagName).toBe('INPUT')
  })
})

describe('ConflictRow override line — the pending write is not the smallest thing in the row', () => {
  it('renders the typed value at the row value size, not 11px caption', () => {
    const eta: CriticConflict = {
      field: 'eta',
      label: 'ETA',
      rationale: 'r',
      candidates: [
        { value: '2026-07-20', source: 'system' },
        { value: '2026-07-23', source: 'SO' },
      ],
    }
    render(
      <table>
        <tbody>
          <ConflictRow conflict={eta} value="2026-07-25" onChange={vi.fn()} editing={false} canEdit />
        </tbody>
      </table>,
    )
    const override = screen.getByTestId('conflict-override')
    expect(override).toHaveTextContent('will write 2026-07-25')
    // The VALUE carries the emphasis — it is what the click commits.
    const value = within(override).getByText('2026-07-25')
    expect(value).toHaveClass('text-sm')
    expect(value).toHaveClass('text-status-success')
    expect(value.className).not.toMatch(/text-\[11px\]/)
  })
})

describe('ConflictRow critical badge', () => {
  it('shows Critical badge when critical is true', () => {
    renderRow({ critical: true })
    expect(screen.getByTestId('conflict-critical-badge')).toHaveTextContent('Critical')
    expect(screen.getByText('ETD')).toBeInTheDocument()
  })

  it('hides Critical badge when critical is false or omitted', () => {
    renderRow({ critical: false })
    expect(screen.queryByTestId('conflict-critical-badge')).not.toBeInTheDocument()
  })
})

// The Mesh mirror behind the party picker — mocked so the row renders without a network call.
vi.mock('../../hooks/use-parties', () => ({
  useParties: (kind: 'customer' | 'vendor' | 'forwarder') => ({
    data:
      kind === 'forwarder'
        ? [{ id: 'f1', code: '002', name: 'LOGIMARK INTERNATIONAL LIMITED' }]
        : [{ id: 'c1', code: 'WYSE', name: 'WYSE LONDON LIMITED', country: 'United Kingdom' }],
  }),
}))

describe('ConflictRow party picker — same master list as the shipment edit form', () => {
  const partyConflict = (field: string, label: string): CriticConflict => ({
    field,
    label,
    rationale: 'Parties differ',
    candidates: [
      { value: 'OLD NAME', source: 'system' },
      { value: 'NEW NAME', source: 'agent' },
    ],
  })

  const renderEditing = (conflict: CriticConflict) =>
    render(
      <table>
        <tbody>
          <ConflictRow conflict={conflict} value="" onChange={vi.fn()} editing canEdit />
        </tbody>
      </table>,
    )

  it('renders the customer picker instead of a bare input', () => {
    renderEditing(partyConflict('customer', 'Customer'))
    expect(screen.getByTestId('party-picker-customer')).toBeInTheDocument()
  })

  it('renders the vendor picker', () => {
    renderEditing(partyConflict('vendor_code', 'Vendor'))
    expect(screen.getByTestId('party-picker-vendor')).toBeInTheDocument()
  })

  it('renders the forwarder picker', () => {
    renderEditing(partyConflict('forwarder_name', 'Forwarder'))
    expect(screen.getByTestId('party-picker-forwarder')).toBeInTheDocument()
  })

  it('leaves a non-party field as a plain input', () => {
    renderEditing(partyConflict('vessel_name', 'Vessel'))
    expect(screen.queryByTestId('party-picker-customer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('party-picker-vendor')).not.toBeInTheDocument()
  })
})

describe('ConflictRow numeric fields — restrict on entry, group on display', () => {
  const qtyConflict = (system: string, proposed: string): CriticConflict => ({
    field: 'qty',
    label: 'Quantity',
    rationale: 'Counts differ',
    candidates: [
      { value: system, source: 'system' },
      { value: proposed, source: 'Packing List' },
    ],
  })

  const renderQty = (opts: { editing: boolean; value: string; conflict?: CriticConflict }) =>
    render(
      <table>
        <tbody>
          <ConflictRow
            conflict={opts.conflict ?? qtyConflict('1180', '1240')}
            value={opts.value}
            onChange={vi.fn()}
            editing={opts.editing}
            canEdit
          />
        </tbody>
      </table>,
    )

  it('editing a numeric field gives the numeric field, not free text', () => {
    renderQty({ editing: true, value: '1240' })
    const input = screen.getByLabelText('Proposed value for Total Quantity')
    // A TEXT input on purpose: type=number mutates on scroll-wheel and blanks a pasted "1,240".
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    // Grouped for readback while the caller still holds raw digits.
    expect((input as HTMLInputElement).value).toBe('1,240')
  })

  it('groups both columns for reading', () => {
    renderQty({ editing: false, value: '1240' })
    expect(screen.getByText('1,180')).toBeInTheDocument()
    expect(screen.getByText('1,240')).toBeInTheDocument()
  })

  it('holds the zero/fractional warning until the field is left', async () => {
    const user = userEvent.setup()
    renderQty({ editing: true, value: '0' })
    // "0" is a normal keystroke on the way to "10" — no shouting mid-word.
    expect(screen.queryByTestId('number-field-error')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Proposed value for Total Quantity'))
    await user.tab()
    expect(screen.getByTestId('number-field-error')).toHaveTextContent(/whole number greater than 0/)
  })

  it('shows no warning for a valid count', async () => {
    const user = userEvent.setup()
    renderQty({ editing: true, value: '1240' })
    await user.click(screen.getByLabelText('Proposed value for Total Quantity'))
    await user.tab()
    expect(screen.queryByTestId('number-field-error')).not.toBeInTheDocument()
  })

  it('echoes the leg UOM beside the number', () => {
    render(
      <table>
        <tbody>
          <ConflictRow
            conflict={qtyConflict('1180', '1240')}
            value="1240"
            onChange={vi.fn()}
            editing
            canEdit
            proposedUnit="cartons"
          />
        </tbody>
      </table>,
    )
    expect(screen.getByTestId('number-field-unit')).toHaveTextContent('cartons')
  })

  it('leaves a non-numeric field as a plain text input', () => {
    const vessel: CriticConflict = {
      field: 'vessel_name',
      label: 'Vessel',
      rationale: 'x',
      candidates: [
        { value: 'EVER GLORY', source: 'system' },
        { value: 'EVER GIVEN', source: 'Draft B/L' },
      ],
    }
    renderQty({ editing: true, value: 'EVER GIVEN', conflict: vessel })
    // A plain input, not the numeric field — no grouping, no unit slot.
    expect(screen.queryByTestId('number-field')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Proposed value for Vessel')).toBeInTheDocument()
  })
})

describe('ConflictRow date fields — the calendar the row never had', () => {
  const etdConflict: CriticConflict = {
    field: 'etd',
    label: 'ETD',
    rationale: 'Dates differ',
    candidates: [
      { value: '2026-08-14', source: 'system' },
      { value: '2026-08-11', source: 'Booking Confirmation' },
    ],
  }

  const renderEtd = (editing: boolean) =>
    render(
      <table>
        <tbody>
          <ConflictRow
            conflict={etdConflict}
            value="2026-08-11"
            onChange={vi.fn()}
            editing={editing}
            canEdit
          />
        </tbody>
      </table>,
    )

  it('editing a date gives the shared calendar, not a text box', () => {
    renderEtd(true)
    expect(screen.getByTestId('datetime-date')).toHaveAttribute('type', 'date')
    // The bare text input it used to render must be gone.
    expect(screen.queryByLabelText('Proposed value for ETD')).toBe(screen.getByTestId('datetime-date'))
  })

  it('ETD is day-level, so it gets NO time box', () => {
    renderEtd(true)
    expect(screen.queryByTestId('datetime-time')).not.toBeInTheDocument()
  })

  it('a cut-off date DOES get the time box', () => {
    const cutoff: CriticConflict = {
      field: 'cfs_cutoff',
      label: 'CFS Cut-off',
      rationale: 'Cut-off moved',
      candidates: [
        { value: '2026-08-07T18:00', source: 'system' },
        { value: '2026-08-09T18:00', source: 'Booking Confirmation' },
      ],
    }
    render(
      <table>
        <tbody>
          <ConflictRow conflict={cutoff} value="2026-08-09T18:00" onChange={vi.fn()} editing canEdit />
        </tbody>
      </table>,
    )
    expect(screen.getByTestId('datetime-time')).toHaveAttribute('type', 'time')
    expect((screen.getByTestId('datetime-time') as HTMLInputElement).value).toBe('18:00')
  })

  it('splits the proposed value across the two boxes', () => {
    renderEtd(true)
    expect((screen.getByTestId('datetime-date') as HTMLInputElement).value).toBe('2026-08-11')
  })

  it('reads as plain text when not editing', () => {
    renderEtd(false)
    expect(screen.queryByTestId('datetime-date')).not.toBeInTheDocument()
    expect(screen.getByText('2026-08-11')).toBeInTheDocument()
  })
})
