const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://StatusTrackAgent.Cobaltknitwear.com',
]

/** Parse the comma-separated CORS_ORIGINS env, or fall back to the dev + prod defaults. */
export function resolveCorsOrigins(raw?: string): string[] {
  if (!raw) return DEFAULT_ORIGINS
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}
