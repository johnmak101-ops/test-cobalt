import { describe, it, expect } from 'vitest'
import { Reflector } from '@nestjs/core'
import { RolesGuard } from './roles.guard'

const ctx = (user: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as never

const guardWith = (required: string[] | undefined) => {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector
  return new RolesGuard(reflector)
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no @Roles is set', () => {
    expect(guardWith(undefined).canActivate(ctx({ role: 'VIEWER' }))).toBe(true)
  })
  it('allows when the user role is in the required set', () => {
    expect(guardWith(['EDITOR', 'ADMIN']).canActivate(ctx({ role: 'EDITOR' }))).toBe(true)
  })
  it('forbids when the user role is not in the required set', () => {
    expect(() => guardWith(['EDITOR', 'ADMIN']).canActivate(ctx({ role: 'VIEWER' }))).toThrow()
  })
  it('forbids when there is no user', () => {
    expect(() => guardWith(['ADMIN']).canActivate(ctx(undefined))).toThrow()
  })
})
