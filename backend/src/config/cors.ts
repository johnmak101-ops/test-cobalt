// Browser origins allowed to call the API with credentials. In production the backend serves the
// SPA same-origin (https://statustrack.cobaltknitwear.com, the app server .18 — NOT the agent host
// statustrackagent/.19, which only talks to the API server-to-server with a Bearer token), so CORS
// is moot for the UI. Set CORS_ORIGINS explicitly in prod; these defaults cover local dev + the app.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://statustrack.cobaltknitwear.com',
]

/** Parse the comma-separated CORS_ORIGINS env, or fall back to the dev + prod defaults. */
export function resolveCorsOrigins(raw?: string): string[] {
  if (!raw) return DEFAULT_ORIGINS
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}
