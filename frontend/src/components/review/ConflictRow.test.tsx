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
