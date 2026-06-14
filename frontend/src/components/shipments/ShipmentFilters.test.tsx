import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShipmentFilters } from './ShipmentFilters'

describe('ShipmentFilters', () => {
  it('renders status chips and reports the chosen value', async () => {
    const onChange = vi.fn()
    render(<ShipmentFilters value="ALL" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft B/L' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Final B/L' }))
    expect(onChange).toHaveBeenCalledWith('SAILED')
  })

  it('highlights the active filter', () => {
    render(<ShipmentFilters value="DELIVERED" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Delivered' }).className).toMatch(/bg-cobalt-primary/)
  })
})
