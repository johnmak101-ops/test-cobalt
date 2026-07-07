import { describe, it, expect, vi } from 'vitest'
import { AuthController } from './auth.controller'

const make = (authOver: Partial<{ login: (...a: unknown[]) => unknown }> = {}) => {
  const auth = { login: vi.fn(), ...authOver } as any
  return { auth, controller: new AuthController(auth) }
}

describe('AuthController.me — wrap + role-map for the UI', () => {
  it('wraps the user under { user } and maps the backend role to a UI label', () => {
    const { controller } = make()
    const out = controller.me({ id: 'u1', email: 'e@x.com', name: 'Ed', role: 'EDITOR' })
    expect(out).toEqual({ user: { id: 'u1', email: 'e@x.com', name: 'Ed', role: 'MANAGER' } })
  })
})

describe('AuthController.login — issue session cookie, no token in body', () => {
  it('sets an httpOnly session cookie and returns only { user }', async () => {
    const { controller } = make({ login: vi.fn().mockResolvedValue({ token: 'tok', user: { id: 'u1', role: 'ADMIN' } }) })
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    const out = await controller.login({ email: 'e@x.com', password: 'pw' }, res as any)
    expect(res.cookie).toHaveBeenCalledWith('session', 'tok', expect.objectContaining({ httpOnly: true }))
    expect(out).toEqual({ user: { id: 'u1', role: 'ADMIN' } })
  })

  it('throws Unauthorized and sets no cookie on bad credentials', async () => {
    const { controller } = make({ login: vi.fn().mockResolvedValue(null) })
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    await expect(controller.login({ email: 'e@x.com', password: 'bad' }, res as any)).rejects.toThrow()
    expect(res.cookie).not.toHaveBeenCalled()
  })
})

describe('AuthController.logout — clear session cookie', () => {
  it('clears the session cookie and returns success', () => {
    const { controller } = make()
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    const out = controller.logout(res as any)
    expect(res.clearCookie).toHaveBeenCalledWith('session')
    expect(out).toEqual({ success: true })
  })
})

describe('AuthController.changePassword — forced/self password change', () => {
  const sessionUser = { id: 'u1', email: 'e@x.com', name: 'Ed', role: 'ADMIN' }
  it('delegates to auth.changePassword for the current user and returns success', async () => {
    const changePassword = vi.fn().mockResolvedValue(true)
    const { controller } = make({ changePassword } as any)
    const out = await controller.changePassword(sessionUser, { currentPassword: 'old', newPassword: 'new' })
    expect(changePassword).toHaveBeenCalledWith('u1', 'old', 'new')
    expect(out).toEqual({ success: true })
  })
  it('throws Unauthorized when the current password is wrong', async () => {
    const changePassword = vi.fn().mockResolvedValue(false)
    const { controller } = make({ changePassword } as any)
    await expect(
      controller.changePassword(sessionUser, { currentPassword: 'bad', newPassword: 'new' }),
    ).rejects.toThrow()
  })
})
