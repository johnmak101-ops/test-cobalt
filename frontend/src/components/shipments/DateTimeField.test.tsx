import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateTimeField } from './DateTimeField'

function Harness({ initial = '' }: { initial?: string }) {
  const [v, setV] = useState(initial)
  return (
    <>
      <DateTimeField value={v} onChange={setV} label="ETD" />
      <output data-testid="out">{v}</output>
    </>
  )
}

const dateBox = () => screen.getByTestId('datetime-date') as HTMLInputElement
const timeBox = () => screen.getByTestId('datetime-time') as HTMLInputElement
const out = () => screen.getByTestId('out').textContent

describe('DateTimeField', () => {
  it('splits a stored value across the two boxes', () => {
    render(<Harness initial="2026-08-11T18:00" />)
    expect(dateBox().value).toBe('2026-08-11')
    expect(timeBox().value).toBe('18:00')
  })

  it('a day-only pick still reaches the caller, defaulted to 00:00', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    // The bug that killed datetime-local: it reports "" until BOTH parts are typed, so a day-only
    // pick never reached the draft and the edit vanished on Save.
    await user.type(dateBox(), '2026-08-11')
    expect(out()).toBe('2026-08-11T00:00')
  })

  it('keeps a stored time through a day-only edit', () => {
    render(<Harness initial="2026-08-11T18:00" />)
    // A real date picker emits ONE change with the new day — not clear-then-retype, which would
    // legitimately blank the value first (see "clearing the day clears the whole value" below).
    fireEvent.change(dateBox(), { target: { value: '2026-08-14' } })
    expect(out()).toBe('2026-08-14T18:00')
  })

  it('disables the time box until a day exists', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(timeBox()).toBeDisabled()
    await user.type(dateBox(), '2026-08-11')
    expect(timeBox()).not.toBeDisabled()
  })

  it('clearing the day clears the whole value', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-08-11T18:00" />)
    await user.clear(dateBox())
    expect(out()).toBe('')
  })

  it('never constructs a Date — the value round-trips as text', () => {
    // A UTC round-trip would move this across midnight; the control must not touch Date at all.
    const onChange = vi.fn()
    render(<DateTimeField value="2026-01-01T00:00" onChange={onChange} label="ETD" />)
    expect(dateBox().value).toBe('2026-01-01')
    expect(timeBox().value).toBe('00:00')
  })

  it('names both boxes for screen readers', () => {
    render(<Harness />)
    expect(screen.getByLabelText('ETD')).toBe(dateBox())
    expect(screen.getByLabelText('ETD time')).toBe(timeBox())
  })
})

describe('DateTimeField showTime — day-level fields get no time box', () => {
  it('hides the time box when showTime is false', () => {
    render(<DateTimeField value="2026-08-11T00:00" onChange={vi.fn()} label="ETA" showTime={false} />)
    expect(screen.getByTestId('datetime-date')).toBeInTheDocument()
    expect(screen.queryByTestId('datetime-time')).not.toBeInTheDocument()
  })

  it('still stores the T00:00 shape, so the value is unchanged by hiding the box', () => {
    const onChange = vi.fn()
    render(<DateTimeField value="" onChange={onChange} label="ETA" showTime={false} />)
    fireEvent.change(screen.getByTestId('datetime-date'), { target: { value: '2026-08-11' } })
    // Local midnight, same as a time-bearing field — hiding the box is presentation, not semantics.
    expect(onChange).toHaveBeenCalledWith('2026-08-11T00:00')
  })

  it('defaults to showing the time box', () => {
    render(<DateTimeField value="" onChange={vi.fn()} label="CFS Cut-off" />)
    expect(screen.getByTestId('datetime-time')).toBeInTheDocument()
  })
})
