import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard } from '@nestjs/throttler'
import { AuthModule } from './auth.module'
import { JwtAuthGuard } from './jwt-auth.guard'
import { MustResetGuard } from './must-reset.guard'
import { RolesGuard } from './roles.guard'
import { AppModule } from '../app.module'

// The global guard ORDER is a security-critical property: every request must be authenticated
// (JwtAuthGuard) BEFORE the must-reset block (which reads req.user) and BEFORE role checks. Nest runs
// APP_GUARD providers in registration order, so this list IS the runtime chain. A full HTTP boot would
// assert it behaviourally, but vitest's esbuild transform drops `emitDecoratorMetadata`, so Nest DI
// can't construct the real graph under the test runner — this reads the wiring metadata instead, which
// is enough to catch a re-order or a dropped guard. (Per-guard behaviour is covered by the *.guard.spec
// files; the login rate-limit metadata by login-throttle.spec.)
const globalGuards = (mod: object): unknown[] =>
  ((Reflect.getMetadata('providers', mod) as Array<{ provide?: unknown; useClass?: unknown }>) ?? [])
    .filter((p) => p && p.provide === APP_GUARD)
    .map((p) => p.useClass)

describe('global guard wiring', () => {
  it('AuthModule registers the request guards in order: JwtAuth → MustReset → Roles', () => {
    expect(globalGuards(AuthModule)).toEqual([JwtAuthGuard, MustResetGuard, RolesGuard])
  })

  it('AppModule registers the ThrottlerGuard globally (rate limiting is active)', () => {
    expect(globalGuards(AppModule)).toContain(ThrottlerGuard)
  })
})
