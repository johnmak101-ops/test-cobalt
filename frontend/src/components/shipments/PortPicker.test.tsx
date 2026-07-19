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
