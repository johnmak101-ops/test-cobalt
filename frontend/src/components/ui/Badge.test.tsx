import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('maps shipment states to human labels', () => {
    render(<Badge variant="status" value="CONFIRMED" />)
    expect(screen.getByText('SO Received')).toBeInTheDocument()
  })

  it('maps BOOKED to Booking Request', () => {
    render(<Badge variant="status" value="BOOKED" />)
    expect(screen.getByText('Booking Request')).toBeInTheDocument()
  })

  it('shows severity values as-is', () => {
    render(<Badge variant="severity" value="CRITICAL" />)
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
  })
})
