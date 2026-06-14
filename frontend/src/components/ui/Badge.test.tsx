import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('maps shipment states to human labels', () => {
    render(<Badge variant="status" value="CONFIRMED" />)
    expect(screen.getByText('Confirmed')).toBeInTheDocument()
  })

  it('maps BOOKED to Booked', () => {
    render(<Badge variant="status" value="BOOKED" />)
    expect(screen.getByText('Booked')).toBeInTheDocument()
  })

  it('shows severity values as-is', () => {
    render(<Badge variant="severity" value="CRITICAL" />)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })
})
