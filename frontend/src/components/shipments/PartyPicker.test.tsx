import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartyPicker } from './PartyPicker'

// The Mesh party mirror, mocked. The picker's point is picking a CODE from it while still allowing a
// party that the ~2-month-lagged mirror has not caught up with to be typed as free text.
// The Mesh party mirror, mocked. Forwarder codes are numeric on purpose — that is the real shape
// (853 of 874 rows), and it is why a forwarder pick stores the NAME while customer/vendor store the
// CODE. Searching still accepts either, for all three kinds.
vi.mock('../../hooks/use-parties', () => ({
  useParties: (kind: 'customer' | 'vendor' | 'forwarder') => ({
    data:
      kind === 'customer'
        ? [
            { id: 'c1', code: 'WYSE', name: 'WYSE LONDON LIMITED', country: 'United Kingdom', nameCh: null },
            { id: 'c2', code: 'STRA', name: 'STRAUSS OPERATIONS Gmbh & Co. KG', country: 'Germany', nameCh: null },
          ]
        : kind === 'forwarder'
          ? [
              { id: 'f1', code: '366', name: 'LOGWIN AIR & OCEAN CHINA LTD.SHENZHEN BRANCH', nameCh: null },
              { id: 'f2', code: 'LEADWAY', name: 'LEADWAY EXPRESS LIMITED', nameCh: null },
            ]
          : [
              { id: 'v1', code: 'ROKNFT', name: 'ROSE KNITTING FACTORY LIMITED', type: 'factory', nameCh: '玫瑰針織廠有限公司' },
              { id: 'v2', code: 'GLDSUN', name: 'GOLDEN SUN KNITTING FTY LTD', type: 'factory', nameCh: null },
            ],
  }),
}))

function Harness({
  kind = 'customer' as const,
  initial = '',
}: {
  kind?: 'customer' | 'vendor' | 'forwarder'
  initial?: string
}) {
  const [v, setV] = useState(initial)
  return <PartyPicker kind={kind} value={v} onChange={setV} ariaLabel="Customer" />
}

describe('PartyPicker', () => {
  it('searches by name and stores the master CODE, not the name', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('Customer')
    await user.type(input, 'wyse lon')
    const option = screen.getByRole('option', { name: /WYSE LONDON LIMITED/ })
    expect(within(option).getByText('WYSE')).toBeInTheDocument()
    await user.click(option)
    // The code is what exactPartyId resolves first, and what the read view shows as "Customer Code".
    expect((input as HTMLInputElement).value).toBe('WYSE')
  })

  it('searches by code', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByLabelText('Customer'), 'stra')
    expect(screen.getByRole('option', { name: /STRAUSS/ })).toBeInTheDocument()
  })

  it('searches a vendor by its Chinese name', async () => {
    const user = userEvent.setup()
    render(<Harness kind="vendor" />)
    const input = screen.getByLabelText('Customer')
    await user.type(input, '玫瑰')
    const option = screen.getByRole('option', { name: /ROSE KNITTING/ })
    await user.click(option)
    expect((input as HTMLInputElement).value).toBe('ROKNFT')
  })

  it('keeps free text for a party the Mesh mirror does not have yet', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const input = screen.getByLabelText('Customer')
    await user.type(input, 'BRAND NEW CUSTOMER LTD')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    // Nothing is swallowed or blocked — it is stored raw and surfaces later as a "not in Mesh" miss.
    expect((input as HTMLInputElement).value).toBe('BRAND NEW CUSTOMER LTD')
  })

  it('shows the code a legacy raw NAME would resolve to', async () => {
    const user = userEvent.setup()
    render(<Harness initial="WYSE LONDON LIMITED" />)
    const input = screen.getByLabelText('Customer')
    // The hint renders only when the list is closed; focus then escape to close it.
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(screen.getByText('WYSE')).toBeInTheDocument()
  })

  /**
   * Reported from the edit form: `ROSE KNITTING FACTORY LIMITED` rendered as
   * `ROSE KNITTING FACTORY LIMITEDNFT` — the value ran under the `ROKNFT` hint, because the hint was
   * `absolute` and so occupied no space. Short values (WYSE, CNYTN) hid it for months.
   *
   * Reserving a gutter inside the field fixed the overlap and bought a worse bug: the value was then
   * CLIPPED, so the operator could not read what they had typed. One line cannot hold both a company
   * name and its code, so the hint moved to its own line.
   */
  it('renders the hint under the field, not floating over the value', async () => {
    const user = userEvent.setup()
    render(<Harness initial="ROSE KNITTING FACTORY LIMITED" kind="vendor" />)
    const input = screen.getByLabelText('Customer') as HTMLInputElement
    await user.click(input)
    await user.keyboard('{Escape}')

    const hint = screen.getByText('ROKNFT')
    const chrome = hint.closest('span.block') ?? hint.parentElement!
    // Nothing overlays the input any more, and nothing steals width from it.
    expect(chrome.className).not.toMatch(/absolute/)
    expect(input.style.paddingRight).toBe('')
    // The value is intact — no truncation of what the operator typed.
    expect(input.value).toBe('ROSE KNITTING FACTORY LIMITED')
  })

  it('shows no hint line when there is nothing to resolve to', async () => {
    const user = userEvent.setup()
    // A forwarder matched by NAME shows no hint — it stores names, so there is no code to nudge
    // toward, and an empty line under the field would be noise.
    render(<Harness kind="forwarder" initial="LEADWAY EXPRESS LIMITED" />)
    const input = screen.getByLabelText('Customer') as HTMLInputElement
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(screen.queryByText('LEADWAY')).toBeNull()
    expect(input.value).toBe('LEADWAY EXPRESS LIMITED')
  })
})

describe('PartyPicker — forwarder searches by code OR name, but stores the name', () => {
  it('finds a forwarder by its numeric code and stores the NAME', async () => {
    const user = userEvent.setup()
    render(<Harness kind="forwarder" />)
    const input = screen.getByLabelText('Customer')
    // An operator who knows the ERP number can type it…
    await user.type(input, '366')
    const option = screen.getByRole('option', { name: /LOGWIN/ })
    expect(within(option).getByText('366')).toBeInTheDocument()
    await user.click(option)
    // …but what lands in forwarderRaw is the readable name, never "366".
    expect((input as HTMLInputElement).value).toBe('LOGWIN AIR & OCEAN CHINA LTD.SHENZHEN BRANCH')
  })

  it('finds the same forwarder by name', async () => {
    const user = userEvent.setup()
    render(<Harness kind="forwarder" />)
    const input = screen.getByLabelText('Customer')
    await user.type(input, 'logwin')
    await user.click(screen.getByRole('option', { name: /LOGWIN/ }))
    expect((input as HTMLInputElement).value).toBe('LOGWIN AIR & OCEAN CHINA LTD.SHENZHEN BRANCH')
  })

  it('finds a mnemonic-coded forwarder too (21 of 874 have one)', async () => {
    const user = userEvent.setup()
    render(<Harness kind="forwarder" />)
    await user.type(screen.getByLabelText('Customer'), 'leadway')
    expect(screen.getByRole('option', { name: /LEADWAY EXPRESS/ })).toBeInTheDocument()
  })

  it('typing a bare code shows which forwarder it is before picking', async () => {
    const user = userEvent.setup()
    render(<Harness kind="forwarder" initial="366" />)
    const input = screen.getByLabelText('Customer')
    await user.click(input)
    await user.keyboard('{Escape}')
    // The hint resolves 366 -> the company, so a typed code is never left opaque.
    expect(screen.getByText(/LOGWIN AIR & OCEAN/)).toBeInTheDocument()
  })
})
