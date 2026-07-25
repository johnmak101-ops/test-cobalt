import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NumberField } from './NumberField'

function Harness({
  initial = '',
  decimals = false,
  unit = null,
  error = null,
}: {
  initial?: string
  decimals?: boolean
  unit?: string | null
  error?: string | null
}) {
  const [v, setV] = useState(initial)
  return (
    <>
      <NumberField
        value={v}
        onChange={setV}
        decimals={decimals}
        unit={unit}
        error={error}
        ariaLabel="Total Quantity"
      />
      <output data-testid="raw">{v}</output>
    </>
  )
}

const box = () => screen.getByLabelText('Total Quantity') as HTMLInputElement
const raw = () => screen.getByTestId('raw').textContent

describe('NumberField', () => {
  it('is a text input — no spinners, so the scroll wheel cannot change it', () => {
    render(<Harness />)
    // type=number is the whole bug: it mutates on wheel while focused, silently.
    expect(box()).toHaveAttribute('type', 'text')
    expect(box()).toHaveAttribute('inputmode', 'numeric')
  })

  it('groups as you type while handing the caller raw digits', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), '13516')
    expect(box().value).toBe('13,516')
    expect(raw()).toBe('13516')
  })

  it('accepts a pasted packing-list value, unit and all', () => {
    render(<Harness />)
    fireEvent.change(box(), { target: { value: '1,240 CTNS' } })
    expect(raw()).toBe('1240')
    expect(box().value).toBe('1,240')
  })

  it('accepts space-separated and already-grouped pastes', () => {
    render(<Harness />)
    fireEvent.change(box(), { target: { value: '1 240' } })
    expect(raw()).toBe('1240')
    fireEvent.change(box(), { target: { value: '13,516' } })
    expect(raw()).toBe('13516')
  })

  it('rejects letters outright rather than blanking the field', () => {
    render(<Harness initial="1240" />)
    fireEvent.change(box(), { target: { value: '12abc40' } })
    expect(raw()).toBe('1240')
  })

  it('keeps a count whole, but lets a measure take one decimal point', () => {
    const { unmount } = render(<Harness />)
    fireEvent.change(box(), { target: { value: '12.5' } })
    expect(raw()).toBe('125')
    unmount()

    render(<Harness decimals />)
    fireEvent.change(box(), { target: { value: '12.5' } })
    expect(raw()).toBe('12.5')
    // A second dot is dropped, not accepted as a new number.
    fireEvent.change(box(), { target: { value: '12.5.7' } })
    expect(raw()).toBe('12.57')
  })

  it('preserves a trailing dot and leading zeros mid-typing', () => {
    render(<Harness decimals />)
    // Number('12.') would eat the dot and Number('07') would rewrite it — grouping is char-wise.
    fireEvent.change(box(), { target: { value: '12.' } })
    expect(box().value).toBe('12.')
    fireEvent.change(box(), { target: { value: '07' } })
    expect(box().value).toBe('07')
  })

  it('holds the error back until the field is left', async () => {
    const user = userEvent.setup()
    render(<Harness initial="0" error="Total Quantity must be a whole number greater than 0" />)
    // "0" is a normal thing to have typed on the way to "10" — do not shout mid-word.
    expect(screen.queryByTestId('number-field-error')).not.toBeInTheDocument()
    await user.click(box())
    await user.tab()
    expect(screen.getByTestId('number-field-error')).toHaveTextContent(/whole number greater than 0/)
    expect(box()).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows no error after blur when the value is fine', async () => {
    const user = userEvent.setup()
    render(<Harness initial="12" error={null} />)
    await user.click(box())
    await user.tab()
    expect(screen.queryByTestId('number-field-error')).not.toBeInTheDocument()
  })

  it('echoes the unit beside the number', () => {
    render(<Harness initial="1240" unit="cartons" />)
    expect(screen.getByTestId('number-field-unit')).toHaveTextContent('cartons')
  })

  it('omits the unit adornment when there is none', () => {
    render(<Harness initial="1240" />)
    expect(screen.queryByTestId('number-field-unit')).not.toBeInTheDocument()
  })

  it('keeps the caret where the operator was typing, not at the end', async () => {
    const user = userEvent.setup()
    render(<Harness initial="1516" />)
    const el = box()
    el.setSelectionRange(0, 0)
    // Type a leading 3 -> "31516" -> regroups to "31,516"; the caret must sit after the 3.
    await user.type(el, '3', { initialSelectionStart: 0, initialSelectionEnd: 0 })
    expect(raw()).toBe('31516')
    expect(el.selectionStart).toBe(1)
  })

  it('clears to empty rather than to zero', () => {
    const onChange = vi.fn()
    render(<NumberField value="1240" onChange={onChange} ariaLabel="Total Quantity" />)
    fireEvent.change(screen.getByLabelText('Total Quantity'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('')
  })
})
