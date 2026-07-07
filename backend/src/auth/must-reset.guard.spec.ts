import { describe, it, expect } from 'vitest'
import { Reflector } from '@nestjs/core'
import { MustResetGuard } from './must-reset.guard'

const ctx = (user: unknown) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
  getHandler: () => ({}),
  getClass: () => ({}),
}) as any

const guardWith = (meta: Record<string, boolean>) => {
  const reflector = { getAllAndOverride: (key: string) => meta[key] } as unknown as Reflector
  return new MustResetGuard(reflector)
}

describe('MustResetGuard', () => {
  it('blocks a must-reset user on a normal route', () => {
    expect(() => guardWith({}).canActivate(ctx({ id: 'u1', mustReset: true }))).toThrow(/MUST_RESET|reset/i)
  })
  it('allows a must-reset user on an @AllowDuringMustReset route', () => {
    expect(guardWith({ allowDuringMustReset: true }).canActivate(ctx({ id: 'u1', mustReset: true }))).toBe(true)
  })
  it('allows a normal user', () => {
    expect(guardWith({}).canActivate(ctx({ id: 'u1', mustReset: false }))).toBe(true)
  })
  it('allows @Public routes (no user)', () => {
    expect(guardWith({ isPublic: true }).canActivate(ctx(undefined))).toBe(true)
  })
})
