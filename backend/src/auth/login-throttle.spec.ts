import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { AuthController } from './auth.controller'

// Version-robust: assert @Throttle put throttler-namespaced metadata on the login handler,
// without depending on the library's exact exported metadata-key constant.
//
// @nestjs/throttler's @Throttle (like Nest's own @SetMetadata) writes metadata onto the
// handler *function* (descriptor.value) rather than under a (prototype, propertyKey) pair —
// the same place ThrottlerGuard reads it from at runtime via context.getHandler(). So the
// reflection target here is the method itself, not Reflect.getMetadataKeys(prototype, 'login').
describe('login rate limiting', () => {
  it('POST /auth/login carries throttler metadata', () => {
    const keys = Reflect.getMetadataKeys(AuthController.prototype.login)
    expect(keys.some((k) => String(k).toLowerCase().includes('throttler'))).toBe(true)
  })
})
