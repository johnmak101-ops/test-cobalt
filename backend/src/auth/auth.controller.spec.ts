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

describe('AuthController.login — issue session cookie', () => {
  it('sets an httpOnly session cookie with the token and returns the auth result', async () => {
    const { controller } = make({ login: vi.fn().mockResolvedValue({ token: 'tok', user: { id: 'u1', role: 'ADMIN' } }) })
    const res = { cookie: vi.fn(), clearCookie: vi.fn() }
    const out = await controller.login({ email: 'e@x.com', password: 'pw' }, res as any)
    expect(res.cookie).toHaveBeenCalledWith('session', 'tok', expect.objectContaining({ httpOnly: true }))
    expect(out).toEqual({ token: 'tok', user: { id: 'u1', role: 'ADMIN' } })
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
