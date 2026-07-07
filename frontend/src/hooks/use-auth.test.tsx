import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './use-auth'

vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'e@x.com', name: 'E', role: 'ADMIN', mustReset: false } }),
    post: vi.fn().mockResolvedValue({ user: { id: 'u1' } }),
  },
}))

function Harness() {
  const { user, login } = useAuth()
  return (
    <div>
      <button onClick={() => void login('e@x.com', 'pw')}>login</button>
      <span data-testid="who">{user?.email ?? 'anon'}</span>
    </div>
  )
}

describe('useAuth (cookie-only)', () => {
  beforeEach(() => localStorage.clear())
  it('logs in without writing any token to localStorage', async () => {
    render(<AuthProvider><Harness /></AuthProvider>)
    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('e@x.com'))
    expect(localStorage.getItem('cobalt_token')).toBeNull()
    expect(Object.keys(localStorage)).not.toContain('cobalt_token')
  })
})
