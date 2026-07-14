import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge — confidence', () => {
  it('renders Low/Medium/High title-case labels', () => {
    const { rerender } = render(<Badge variant="confidence" value="low" />)
    expect(screen.getByText('Low')).toBeInTheDocument()

    rerender(<Badge variant="confidence" value="medium" />)
    expect(screen.getByText('Medium')).toBeInTheDocument()

    rerender(<Badge variant="confidence" value="high" />)
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('applies critical/warning/success status tokens by band', () => {
    const { container, rerender } = render(<Badge variant="confidence" value="low" />)
    expect(container.firstChild).toHaveClass('text-status-critical')

    rerender(<Badge variant="confidence" value="medium" />)
    expect(container.firstChild).toHaveClass('text-status-warning')

    rerender(<Badge variant="confidence" value="high" />)
    expect(container.firstChild).toHaveClass('text-status-success')
  })
})
