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

  it('allows typing a day value in the center', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DaysStepper value={2} onChange={onChange} min={0} max={30} aria-label="Threshold" />)
    const input = screen.getByRole('textbox', { name: /threshold value/i })
    await user.clear(input)
    await user.type(input, '7')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(7)
  })
})
