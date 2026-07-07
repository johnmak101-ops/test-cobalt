/** Single source of truth for session lifetime — drives the JWT expiry AND (later) the cookie maxAge. */
export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_HOURS ?? 12) * 60 * 60
export const SESSION_COOKIE = 'session'
export const PASSWORD_MIN_LENGTH = 8
