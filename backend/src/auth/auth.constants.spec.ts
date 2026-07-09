import { describe, it, expect } from 'vitest'
import type { ConfigService } from '@nestjs/config'
import { sessionTtlSeconds, DEFAULT_SESSION_TTL_HOURS, cookieSecure, sessionCookieOptions } from './auth.constants'

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

describe('cookieSecure — COOKIE_SECURE valve overrides the NODE_ENV default', () => {
  it('forces Secure ON for true/1 (case-insensitive), even outside production', () => {
    expect(cookieSecure({ COOKIE_SECURE: 'true', NODE_ENV: 'development' })).toBe(true)
    expect(cookieSecure({ COOKIE_SECURE: '1' })).toBe(true)
    expect(cookieSecure({ COOKIE_SECURE: 'TRUE' })).toBe(true)
  })
  it('forces Secure OFF for false/0 even in production (the HTTP-only intranet escape valve)', () => {
    expect(cookieSecure({ COOKIE_SECURE: 'false', NODE_ENV: 'production' })).toBe(false)
    expect(cookieSecure({ COOKIE_SECURE: '0', NODE_ENV: 'production' })).toBe(false)
  })
  it('falls back to NODE_ENV=production when COOKIE_SECURE is unset or unrecognised', () => {
    expect(cookieSecure({ NODE_ENV: 'production' })).toBe(true)
    expect(cookieSecure({ NODE_ENV: 'development' })).toBe(false)
    expect(cookieSecure({})).toBe(false)
    expect(cookieSecure({ COOKIE_SECURE: 'yes', NODE_ENV: 'production' })).toBe(true) // garbage → NODE_ENV wins
  })
})

describe('sessionCookieOptions — shared login-set / logout-clear attributes', () => {
  it('is always httpOnly + sameSite lax, with secure driven by the valve', () => {
    expect(sessionCookieOptions({ NODE_ENV: 'production' })).toEqual({ httpOnly: true, sameSite: 'lax', secure: true })
    expect(sessionCookieOptions({ COOKIE_SECURE: 'false', NODE_ENV: 'production' })).toEqual({ httpOnly: true, sameSite: 'lax', secure: false })
  })
})
