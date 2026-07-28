import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NewShipmentModal } from './NewShipmentModal'
import { EDITABLE_FIELDS, createFieldKey } from '../../lib/review-fields'
import { isOffModeField } from '../../lib/mode-fields'

const mutate = vi.fn()
vi.mock('../../hooks/use-shipments', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/use-shipments')>(
    '../../hooks/use-shipments',
  )
  return { ...actual, useCreateShipment: () => ({ mutate, isPending: false }) }
})
// The master pickers mount their own queries; without these they would hit the real backend from jsdom.
vi.mock('../../hooks/use-ports', () => ({ usePorts: () => ({ data: [] }) }))
vi.mock('../../hooks/use-parties', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/use-parties')>('../../hooks/use-parties')
  return { ...actual, useParties: () => ({ data: [] }) }
})

function renderModal() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <NewShipmentModal onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const labelFor = (label: string) => screen.getByText(label).closest('label')!
const inputFor = (label: string) => labelFor(label).querySelector('input')!

describe('NewShipmentModal numeric fields — derived from isNumericColumn, not hand-listed', () => {
  it('renders the numeric field as the numeric field, not type=number', () => {
    renderModal()
    expect(inputFor('Total Quantity')).toHaveAttribute('type', 'text')
    // qty is a physical count — the keypad has no decimal point.
    expect(inputFor('Total Quantity')).toHaveAttribute('inputmode', 'numeric')
  })

  it('leaves text fields alone', () => {
    renderModal()
    expect(inputFor('Booking No.')).not.toHaveAttribute('type', 'number')
    expect(inputFor('Container No.')).not.toHaveAttribute('type', 'number')
  })

  it('holds the range warning until the field is left', async () => {
    const user = userEvent.setup()
    renderModal()
    // A minus sign never even reaches the value now — it is not a digit.
    await user.type(inputFor('Total Quantity'), '0')
    expect(screen.queryByTestId('number-field-error')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByTestId('number-field-error')).toHaveTextContent(/whole number greater than 0/)
  })
})

/**
 * The create form and the shipment detail page's edit form are ONE form generated twice. These tests
 * are the guard on that claim — the drift they catch is the drift that let `dsfsdf` be saved as a port
 * of loading, because this form used a plain input where the detail page used a master picker.
 */
describe('NewShipmentModal — the same fields, editors and rules as the shipment detail page', () => {
  it('offers every field the detail page edits (no hand-picked subset)', () => {
    renderModal()
    // Mode starts empty, so nothing is off-mode and every field is on screen at once.
    const missing = EDITABLE_FIELDS.filter((f) => screen.queryAllByText(f.label).length === 0).map((f) => f.label)
    expect(missing).toEqual([])
  })

  it('renders the master PICKERS for ports and parties, not free-text inputs', () => {
    renderModal()
    for (const label of ['POL', 'POD', 'Customer Code', 'Vendor Code', 'Forwarder']) {
      // Both pickers are comboboxes over their master list; a plain <input> has no listbox role.
      expect(inputFor(label)).toHaveAttribute('role', 'combobox')
    }
  })

  it('renders enum fields as selects and date fields as the shared date editor', () => {
    renderModal()
    expect(screen.getByTestId('create-select-mode')).toBeInTheDocument()
    expect(screen.getByTestId('create-select-qtyUnit')).toBeInTheDocument()
    // WH End carries a clock time on the detail page; ETD does not. Same rule here.
    expect(labelFor('WH End Date').querySelectorAll('input')).toHaveLength(2)
    expect(labelFor('ETD').querySelectorAll('input')).toHaveLength(1)
  })

  it('hides the other mode’s fields once a mode is chosen, and offers to clear one already typed', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(inputFor('Flight No.'), 'CX251')
    await user.selectOptions(screen.getByTestId('create-select-mode'), 'SEA')

    expect(screen.queryByText('MAWB')).not.toBeInTheDocument() // off-mode AND empty → hidden
    expect(screen.getByText('Flight No.')).toBeInTheDocument() // off-mode BUT typed → stays, flagged
    expect(screen.getByTestId('create-off-mode-clear-flightNo')).toBeInTheDocument()
    expect(isOffModeField('flightNo', 'SEA')).toBe(true)
  })

  it('blocks a save whose arrival precedes its departure, naming the field like the detail page', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(inputFor('Booking No.'), 'BK-1')
    await user.type(inputFor('ETD'), '2026-08-12')
    await user.type(inputFor('ETA'), '2026-08-07')
    expect(screen.getByText(/ETA is before ETD/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeDisabled()
  })

  it('posts each field under the key POST /shipments expects, not the leg column name', async () => {
    const user = userEvent.setup()
    mutate.mockClear()
    renderModal()
    await user.type(inputFor('Booking No.'), 'BK-77')
    await user.type(inputFor('Customer Code'), 'WYSE')
    await user.type(inputFor('POL'), 'HKHKG')
    await user.click(screen.getByRole('button', { name: /Create shipment/ }))

    const body = mutate.mock.calls[0]![0] as Record<string, unknown>
    expect(body).toMatchObject({ bookingNo: 'BK-77', customerCode: 'WYSE', pol: 'HKHKG' })
    // the raw-column names must NOT leak onto the wire — the create endpoint does not know them
    expect(body.customerRaw).toBeUndefined()
    expect(body.polRaw).toBeUndefined()
  })

  it('maps every editable field to a create key — the rename list has no gaps', () => {
    // Guards the five master-resolved fields (customerRaw→customerCode …) against a sixth being added
    // to EDITABLE_FIELDS without its createKey, which would silently post an unknown key the backend drops.
    const RENAMED = new Set(['customerRaw', 'vendorRaw', 'forwarderRaw', 'polRaw', 'podRaw'])
    for (const f of EDITABLE_FIELDS) {
      expect(createFieldKey(f)).toBeTruthy()
      expect(createFieldKey(f) === f.column).toBe(!RENAMED.has(f.column))
    }
  })

  it('still refuses a shipment with no identity and no PO', async () => {
    renderModal()
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeDisabled()
    await userEvent.setup().type(screen.getByText('PO#(s)').closest('label')!.querySelector('input')!, 'PO-1')
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeEnabled()
  })
})
