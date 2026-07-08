import { describe, it, expect, vi } from 'vitest'
import { AuthController } from './auth.controller'

const make = (authOver: Partial<{ login: (...a: unknown[]) => unknown }> = {}, ttlHours?: number) => {
  const auth = { login: vi.fn(), ...authOver } as any
  // ConfigService stub — controller reads SESSION_TTL_HOURS for the cookie maxAge (undefined ⇒ 12h default).
  const config = { get: () => ttlHours } as any
  return { auth, controller: new AuthController(auth, config) }
}

describe('AuthController.me — wrap + role-map for the UI', () => {
  it('wraps the user under { user } and maps the backend role to a UI label', () => {
    const { controller } = make()
    const out = controller.me({ id: 'u1', email: 'e@x.com', name: 'Ed', role: 'EDITOR' })
    expect(out).toEqual({ user: { id: 'u1', email: 'e@x.com', name: 'Ed', role: 'MANAGER' } })
  })
})

describe('AuthController.login — issue session cookie, no token in body', () => {
  it('sets an httpOnly session cookie (maxAge = default 12h) and returns only { user }', async () => {
    const { controller } = make({ login: vi.fn().mockResolvedValue({ token: 'tok', user: { id: 'u1', role: 'ADMIN' } }) })
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    const out = await controller.login({ email: 'e@x.com', password: 'pw' }, res as any)
    expect(res.cookie).toHaveBeenCalledWith(
      'session',
      'tok',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 }),
    )
    expect(out).toEqual({ user: { id: 'u1', role: 'ADMIN' } })
  })

  it('cookie maxAge honours a configured SESSION_TTL_HOURS', async () => {
    const { controller } = make({ login: vi.fn().mockResolvedValue({ token: 'tok', user: { id: 'u1', role: 'ADMIN' } }) }, 1)
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    await controller.login({ email: 'e@x.com', password: 'pw' }, res as any)
    expect(res.cookie).toHaveBeenCalledWith('session', 'tok', expect.objectContaining({ maxAge: 60 * 60 * 1000 }))
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
