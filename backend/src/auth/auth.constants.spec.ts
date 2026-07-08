import { describe, it, expect } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { sessionTtlSeconds, DEFAULT_SESSION_TTL_HOURS } from './auth.constants'

// A minimal ConfigService stand-in — sessionTtlSeconds only reads .get('SESSION_TTL_HOURS').
const cfg = (val: unknown): ConfigService => ({ get: () => val }) as unknown as ConfigService

describe('sessionTtlSeconds', () => {
  it('defaults to 12h when SESSION_TTL_HOURS is unset', () => {
    expect(sessionTtlSeconds(cfg(undefined))).toBe(DEFAULT_SESSION_TTL_HOURS * 60 * 60)
    expect(sessionTtlSeconds(cfg(undefined))).toBe(43_200)
  })

  it('honours a numeric SESSION_TTL_HOURS (validated/coerced config value)', () => {
    expect(sessionTtlSeconds(cfg(24))).toBe(24 * 60 * 60)
  })

  it('coerces a string SESSION_TTL_HOURS (raw .env value read before coercion)', () => {
    expect(sessionTtlSeconds(cfg('48'))).toBe(48 * 60 * 60)
  })

  it('falls back to the default for a garbage/non-numeric value', () => {
    expect(sessionTtlSeconds(cfg('nonsense'))).toBe(DEFAULT_SESSION_TTL_HOURS * 60 * 60)
  })
})
