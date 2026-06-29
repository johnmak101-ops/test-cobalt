/**
 * Read the JWT out of the `session` cookie (raw Cookie header), so the new UI — which sends
 * `credentials:'include'` and no Authorization header — authenticates without adding cookie-parser.
 * Pure; safe on any request-like object.
 */
export function cookieTokenExtractor(
  req: { headers?: { cookie?: string | null } } | null | undefined,
  cookieName = 'session',
): string | null {
  const raw = req?.headers?.cookie
  if (!raw || typeof raw !== 'string') return null
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === cookieName) {
      const val = part.slice(eq + 1).trim()
      return val ? decodeURIComponent(val) : null
    }
  }
  return null
}
