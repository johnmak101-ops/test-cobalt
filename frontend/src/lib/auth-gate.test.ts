import { describe, it, expect } from 'vitest'
import { authGate } from './auth-gate'

const user = (mustReset: boolean) => ({ id: 'u1', name: 'U', email: 'u@x.com', role: 'ADMIN', avatarInitials: 'U', mustReset }) as never

describe('authGate — what a protected route should render', () => {
  it('returns "loading" while the session is being restored', () => {
    expect(authGate(null, true)).toBe('loading')
  })
  it('returns "login" when there is no user', () => {
    expect(authGate(null, false)).toBe('login')
  })
  it('returns "reset" when the user must change their password first', () => {
    expect(authGate(user(true), false)).toBe('reset')
  })
  it('returns "ok" for a normal authenticated user', () => {
    expect(authGate(user(false), false)).toBe('ok')
  })
})
