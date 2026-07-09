import type { ConfigService } from '@nestjs/config'

export const SESSION_COOKIE = 'session'
export const PASSWORD_MIN_LENGTH = 8
export const DEFAULT_SESSION_TTL_HOURS = 12

/**
 * Session lifetime in seconds — the single source of truth for BOTH the JWT `expiresIn` and the
 * session-cookie `maxAge`.
 *
 * Resolved via ConfigService, NOT a module-load-time `process.env` read: static imports evaluate
 * before ConfigModule loads `.env`, so a top-level `Number(process.env.SESSION_TTL_HOURS ?? 12)`
 * always saw `undefined` and silently pinned 12h — a `.env`-file value was ignored. Reading through
 * ConfigService (after `.env` is loaded and validated) makes the knob actually work. `Number(...)`
 * tolerates both the validated number and a raw string; a missing/garbage value falls back to 12h.
 */
export function sessionTtlSeconds(config: ConfigService): number {
  const hours = Number(config.get('SESSION_TTL_HOURS')) || DEFAULT_SESSION_TTL_HOURS
  return hours * 60 * 60
}

/**
 * Whether the session cookie carries the `Secure` attribute. `COOKIE_SECURE` overrides the NODE_ENV
 * heuristic: 'true'/'1' force Secure ON, 'false'/'0' force it OFF — the escape valve for an HTTP-only
 * intranet deploy, where a Secure cookie would silently never set and break login with no error. Default:
 * Secure in production, plain otherwise. Read at request time (not module load) so the env is honoured.
 */
export function cookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.COOKIE_SECURE?.toLowerCase()
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return env.NODE_ENV === 'production'
}

/**
 * The session-cookie attributes shared by login's `res.cookie` (set) and logout's `res.clearCookie` (clear).
 * They MUST match (especially `secure` + `sameSite`) or the browser won't clear a Secure/SameSite cookie.
 */
export function sessionCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return { httpOnly: true as const, sameSite: 'lax' as const, secure: cookieSecure(env) }
}
