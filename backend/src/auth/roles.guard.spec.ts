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

describe('RolesGuard (rank-based hierarchy)', () => {
  it('allows any authenticated user when no @Roles is set', () => {
    expect(guardWith(undefined).canActivate(ctx({ role: 'VIEWER' }))).toBe(true)
  })
  it('allows the exact required role', () => {
    expect(guardWith(['EDITOR']).canActivate(ctx({ role: 'EDITOR' }))).toBe(true)
  })
  it('allows a HIGHER role than required (admin on an editor route)', () => {
    expect(guardWith(['EDITOR', 'ADMIN']).canActivate(ctx({ role: 'ADMIN' }))).toBe(true)
  })
  it('allows SUPERADMIN on an ADMIN route', () => {
    expect(guardWith(['ADMIN']).canActivate(ctx({ role: 'SUPERADMIN' }))).toBe(true)
  })
  it('forbids a LOWER role (admin on a superadmin route)', () => {
    expect(() => guardWith(['SUPERADMIN']).canActivate(ctx({ role: 'ADMIN' }))).toThrow()
  })
  it('forbids viewer on an editor route', () => {
    expect(() => guardWith(['EDITOR']).canActivate(ctx({ role: 'VIEWER' }))).toThrow()
  })
  it('forbids when there is no user', () => {
    expect(() => guardWith(['ADMIN']).canActivate(ctx(undefined))).toThrow()
  })
})
