import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsersSettings } from './UsersSettings'

vi.mock('../../hooks/use-users', () => ({
  useUsers: () => ({
    data: [
      { id: 'u1', email: 'sue@cobalt.hk', name: 'Sue Super', role: 'SUPERADMIN', active: true, mustReset: false, avatarInitials: 'SS', createdAt: '' },
      { id: 'u2', email: 'newbie@cobalt.hk', name: 'Newbie', role: 'VIEWER', active: true, mustReset: true, avatarInitials: 'NB', createdAt: '' },
    ],
    isLoading: false,
    isError: false,
  }),
  useCreateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateUser: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('UsersSettings', () => {
  it('lists users and flags the one pending first login', () => {
    render(<UsersSettings />)
    expect(screen.getByText('sue@cobalt.hk')).toBeInTheDocument()
    expect(screen.getByText('newbie@cobalt.hk')).toBeInTheDocument()
    expect(screen.getByText(/must reset/i)).toBeInTheDocument()
  })
  it('shows an Add User control', () => {
    render(<UsersSettings />)
    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument()
  })
})
