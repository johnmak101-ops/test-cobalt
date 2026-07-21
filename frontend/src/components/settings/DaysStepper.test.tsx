import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DaysStepper } from './DaysStepper'

describe('DaysStepper', () => {
  it('increments and decrements required value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DaysStepper value={2} onChange={onChange} min={0} max={30} />)
    await user.click(screen.getByRole('button', { name: /increase/i }))
    expect(onChange).toHaveBeenCalledWith(3)
    await user.click(screen.getByRole('button', { name: /decrease/i }))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('does not go below min or above max', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<DaysStepper value={0} onChange={onChange} min={0} max={2} />)
    await user.click(screen.getByRole('button', { name: /decrease/i }))
    expect(onChange).not.toHaveBeenCalled()
    rerender(<DaysStepper value={2} onChange={onChange} min={0} max={2} />)
    onChange.mockClear()
    await user.click(screen.getByRole('button', { name: /increase/i }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('optional: empty starts at 1 on +; − from 1 clears', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <DaysStepper value={null} optional onChange={onChange} emptyLabel="Default" />,
    )
    expect(screen.getByText('Default')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /increase/i }))
    expect(onChange).toHaveBeenCalledWith(1)
    rerender(<DaysStepper value={1} optional onChange={onChange} emptyLabel="Default" />)
    await user.click(screen.getByRole('button', { name: /decrease/i }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('allows typing a day value in the center and live-commits', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DaysStepper value={2} onChange={onChange} min={0} max={30} aria-label="Threshold" />)
    const input = screen.getByRole('textbox', { name: /threshold value/i })
    await user.clear(input)
    await user.type(input, '7')
    // Live onChange on each digit path ends at 7
    expect(onChange).toHaveBeenCalledWith(7)
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(7)
  })

  it('keyboard arrows change value when not editing', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DaysStepper value={5} onChange={onChange} min={0} max={30} aria-label="Days" />)
    const group = screen.getByRole('group', { name: /days/i })
    group.focus()
    await user.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenCalledWith(6)
    await user.keyboard('{ArrowDown}')
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('disabled steppers do not fire onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DaysStepper value={2} onChange={onChange} disabled />)
    await user.click(screen.getByRole('button', { name: /increase/i }))
    await user.click(screen.getByRole('button', { name: /decrease/i }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
