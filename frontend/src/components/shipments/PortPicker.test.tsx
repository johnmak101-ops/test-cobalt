import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PortPicker } from './PortPicker'

// The seeded ports master, mocked — the picker's whole point is picking from it (search) while still
// allowing a free-text port that is not in it.
vi.mock('../../hooks/use-ports', () => ({
  usePorts: () => ({
    data: [
      { unlocode: 'CNYTN', name: 'Yantian', country: 'China', mode: 'sea', iata: null },
      { unlocode: 'GBFXT', name: 'Felixstowe', country: 'United Kingdom', mode: 'sea', iata: null },
      { unlocode: 'VNSGN', name: 'Ho Chi Minh City', country: 'Vietnam', mode: 'sea', iata: 'SGN' },
    ],
  }),
}))

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial)
  return <PortPicker value={v} onChange={setV} ariaLabel="POL" />
}

/**
 * Reported from the review desk: "the searching list is broken, cannot see the list."
 *
 * It was never broken — it was CLIPPED. `REVIEW_TD` sets `overflow-hidden` and the decision grid's
 * wrapper sets `overflow-x-auto` (which computes `overflow-y: auto`), so an `absolute` list inside a
 * table cell got cut at the row boundary: one truncated option on a tall row, a bare sliver on a
 * short one. z-index cannot fix clipping, so the list is positioned FIXED instead.
 */
describe('PortPicker — the list escapes any ancestor that clips', () => {
  it('positions the listbox fixed, not absolute inside the clipped cell', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('POL'), 'yant')
    const list = screen.getByRole('listbox')
    expect(list.style.position).toBe('fixed')
    // The old geometry came from classes an ancestor could clip; it must not come back.
    expect(list.className).not.toMatch(/\babsolute\b/)
    expect(list.className).not.toMatch(/\bw-full\b/)
    expect(list.className).not.toMatch(/max-h-60/)
  })

  it('still closes on an outside click — fixed must not break the root containment check', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Harness />
        <button type="button">elsewhere</button>
      </div>,
    )
    await user.type(screen.getByLabelText('POL'), 'yant')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('PortPicker', () => {
  it('searches by name and stores the picked UN/LOCODE', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('POL')
    await user.type(input, 'yant')
    // the matching port surfaces as an option…
    const option = screen.getByRole('option', { name: /Yantian/ })
    expect(within(option).getByText('CNYTN')).toBeInTheDocument()
    await user.click(option)
    // …and picking it stores the code, not the typed name
    expect((input as HTMLInputElement).value).toBe('CNYTN')
  })

  it('searches by UN/LOCODE too', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('POL'), 'GBFX')
    expect(screen.getByRole('option', { name: /Felixstowe/ })).toBeInTheDocument()
  })

  it('keeps a free-text port that is not in the master (nothing is un-enterable)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('POL') as HTMLInputElement
    await user.type(input, 'Nowhereport')
    // no master match, but the typed value is retained (raw fallback)
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input.value).toBe('Nowhereport')
  })

  it('shows the resolved port name as a hint when the value is a known code', () => {
    render(<Harness initial="CNYTN" />)
    // the code is not opaque — the friendly name rides alongside it
    expect(screen.getByText('Yantian')).toBeInTheDocument()
  })
})
