import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '../../hooks/use-auth'

vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn() }))
vi.mock('../../hooks/use-review', () => ({ useReviewQueue: () => ({ data: [] }) }))
vi.mock('../../hooks/use-alerts', () => ({ useAlerts: () => ({ data: [] }) }))

const renderAs = (role: string) => {
  ;(useAuth as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ user: { role, name: 'X', email: 'x@y' } })
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  )
}

describe('Sidebar role-gated nav', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a VIEWER sees core nav but not Review Queue / Settings / Users', () => {
    renderAs('VIEWER')
    expect(screen.getByText('Shipments')).toBeInTheDocument()
    expect(screen.getByText('Purchase Orders')).toBeInTheDocument()
    expect(screen.queryByText('Review Queue')).not.toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
  })

  it('an EDITOR also sees Review Queue, but not Settings / Users', () => {
    renderAs('EDITOR')
    expect(screen.getByText('Review Queue')).toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
    expect(screen.queryByText('Users')).not.toBeInTheDocument()
  })

  it('a SUPERADMIN sees every nav item', () => {
    renderAs('SUPERADMIN')
    for (const label of ['Dashboard', 'Shipments', 'Purchase Orders', 'Review Queue', 'Alerts', 'Settings', 'Users']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
