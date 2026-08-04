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

/**
 * The backend has always rejected a malformed container number. It arrived as a single line at the
 * foot of a 31-field scrolling form — "Failed to create — Container No. must be 4 letters + 7 digits"
 * — after a round trip, naming a field that had scrolled off screen. The rule was never the problem.
 */
describe('NewShipmentModal — a format error belongs on its own field', () => {
  it('flags a malformed container number inline, and blocks the round-trip', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(inputFor('Booking No.'), 'BK-1')
    await user.type(inputFor('Container No.'), '123123123')

    // nothing yet — "MSBU" is a normal thing to have typed on the way to "MSBU7281200"
    expect(screen.queryByTestId('text-field-error')).not.toBeInTheDocument()
    await user.tab()

    expect(screen.getByTestId('text-field-error')).toHaveTextContent(/4 letters \+ 7 digits/)
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeDisabled()
  })

  it('flags a malformed SCAC the same way', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(inputFor('Booking No.'), 'BK-1')
    await user.type(inputFor('SCAC Code'), '12345')
    await user.tab()
    expect(screen.getByTestId('text-field-error')).toHaveTextContent(/2–4 letters/)
    expect(screen.getByRole('button', { name: /Create shipment/ })).toBeDisabled()
  })

  it('clears once the value is right, and the create goes through', async () => {
    const user = userEvent.setup()
    mutate.mockClear()
    renderModal()
    await user.type(inputFor('Booking No.'), 'BK-1')
    await user.type(inputFor('Container No.'), '123')
    await user.tab()
    expect(screen.getByTestId('text-field-error')).toBeInTheDocument()

    await user.clear(inputFor('Container No.'))
    await user.type(inputFor('Container No.'), 'MSBU7281200')
    expect(screen.queryByTestId('text-field-error')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Create shipment/ }))
    expect(mutate.mock.calls[0]![0]).toMatchObject({ containerNo: 'MSBU7281200' })
  })

  it('leaves ungated text fields alone — no shape means no complaint', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(inputFor('Vessel'), '!!! whatever 123')
    await user.tab()
    expect(screen.queryByTestId('text-field-error')).not.toBeInTheDocument()
  })
})

describe('NewShipmentModal — a long value needs more than one line', () => {
  const ADDRESS = 'Leadway Freight Limited, Suite 2708, 27/F, Skyline Tower, 39 Wang Kwong Road, Kowloon Bay, Kowloon, Hong Kong'

  it('renders Consignee Address as a wrapping textarea, not a one-line input', () => {
    renderModal()
    const control = labelFor('Consignee Address').querySelector('textarea')
    expect(control).toBeInTheDocument()
    expect(labelFor('Consignee Address').querySelector('input')).toBeNull()
  })

  it('gives it the full row, so it is not reading an address block in half a column', () => {
    renderModal()
    expect(labelFor('Consignee Address').className).toMatch(/sm:col-span-2/)
  })

  it('holds the whole value and still posts it intact', async () => {
    const user = userEvent.setup()
    mutate.mockClear()
    renderModal()
    await user.type(inputFor('Booking No.'), 'BK-1')
    const area = labelFor('Consignee Address').querySelector('textarea')!
    await user.click(area)
    await user.paste(ADDRESS)
    expect(area).toHaveValue(ADDRESS)

    await user.click(screen.getByRole('button', { name: /Create shipment/ }))
    expect(mutate.mock.calls[0]![0]).toMatchObject({ consigneeAddress: ADDRESS })
  })

  it('leaves every other text field on one line — only prose gets the textarea', () => {
    renderModal()
    for (const label of ['Booking No.', 'Consignee Name', 'Vessel', 'Container No.']) {
      expect(labelFor(label).querySelector('textarea')).toBeNull()
      expect(labelFor(label).querySelector('input')).toBeInTheDocument()
    }
  })
})

/**
 * A part-filled form must not vanish. Three separate paths were discarding it with no warning, all
 * reported as "the popup auto-escapes before I finish filling it in".
 */
describe('NewShipmentModal — dismissal must never silently discard typed input', () => {
  function renderWithClose() {
    const onClose = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NewShipmentModal onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { onClose }
  }

  it('Escape from inside a <select> closes the DROPDOWN, not the form', async () => {
    // The browser already consumed Escape to dismiss the dropdown; the keydown then bubbled to window
    // and tore the modal down, so picking a UOM/Mode and changing your mind wiped everything.
    const { onClose } = renderWithClose()
    const select = document.querySelector('select')!
    select.focus()
    select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escape on an EMPTY form still closes it (no pointless prompt)', async () => {
    const { onClose } = renderWithClose()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape on a DIRTY form asks first, and honours "cancel"', async () => {
    const { onClose } = renderWithClose()
    await userEvent.type(inputFor('Total Quantity'), '4284')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(confirm).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('a drag that STARTS in a field and ENDS on the backdrop does not close the form', async () => {
    // A click fires on mouse-UP at the common ancestor, so selecting text and releasing past the panel
    // edge (or dragging the panel scrollbar) delivered the click to the backdrop.
    const { onClose } = renderWithClose()
    const field = inputFor('Total Quantity')
    const backdrop = document.querySelector('.fixed.inset-0')! as HTMLElement
    field.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a genuine press-and-release on the backdrop still closes an empty form', async () => {
    const { onClose } = renderWithClose()
    const backdrop = document.querySelector('.fixed.inset-0')! as HTMLElement
    backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })
})
