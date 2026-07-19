import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContestedLockCard } from './ContestedLockCard'

const mutate = vi.fn()
vi.mock('../../hooks/use-shipments', () => ({
  useResolveContestedLock: () => ({ mutate, isPending: false }),
}))

describe('ContestedLockCard', () => {
  it('renders each contested field with keep/restore actions wired to resolve', async () => {
    const user = userEvent.setup()
    render(
      <ContestedLockCard
        shipmentId="s1"
        locks={[{ field: 'etd', yourValue: '2026-06-28T00:00:00.000Z', newValue: '2026-07-05T00:00:00.000Z' }]}
      />,
    )
    expect(screen.getByText('ETD')).toBeInTheDocument() // field label
    expect(screen.getByTestId('contested-etd')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /keep new value/i }))
    expect(mutate).toHaveBeenCalledWith({ field: 'etd', action: 'keep-new' }, expect.anything())

    await user.click(screen.getByRole('button', { name: /restore my edit/i }))
    expect(mutate).toHaveBeenCalledWith({ field: 'etd', action: 'restore' }, expect.anything())
  })

  it('renders nothing when there are no contested locks', () => {
    const { container } = render(<ContestedLockCard shipmentId="s1" locks={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
