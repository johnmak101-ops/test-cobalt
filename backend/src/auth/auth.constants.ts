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
