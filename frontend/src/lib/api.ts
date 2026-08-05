const backendPort: string = import.meta.env?.VITE_BACKEND_PORT ?? '3000'

/**
 * Resolve the API base for the page's origin.
 *
 * Same-origin `/api` is the default: the backend serves the SPA, so the API rides the same origin —
 * whether that's a real host over HTTP/HTTPS (prod, incl. the implicit :443 where `port` is ''),
 * a Vite proxied dev server on any port, or the backend itself on :3000.
 * A purely port-based check mis-classifies the prod HTTPS host (port '') as "other" and points the
 * browser at `http://localhost:3000` — blocked as mixed content.
 *
 * On localhost, the Vite dev server always proxies `/api` to the backend (see vite.config.ts proxy),
 * regardless of which port Vite is assigned to. The direct `http://localhost:{backendPort}` fallback
 * was for a non-proxying static server, but in practice the frontend is always served by either Vite
 * (which proxies /api) or the backend (which handles /api natively) — so same-origin `/api` works.
 */
export function resolveApiBase(loc: Pick<Location, 'hostname' | 'port'>, _backendPort: string): string {
  const isLocalHost = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'
  // On localhost, Vite always proxies /api; on a real host, same-origin /api is correct.
  // Only when on localhost but NOT via a Vite/proxy server would a direct connection be needed —
  // but that case doesn't exist in practice for this codebase.
  if (!isLocalHost) return '/api'
  if (loc.port === '' || loc.port === '3000') return '/api'
  // Any other localhost port (5173, 5176, etc.) is a Vite dev server with proxy → /api
  return '/api'
}

const API_BASE = resolveApiBase(window.location, backendPort)

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include', // httpOnly session cookie
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.text()
    // Surface NestJS's `message` (the specific reason, e.g. a failed validation like "Total Quantity
    // cannot be negative") when the error body is JSON; fall back to the raw text. Keep the status
    // prefix so callers that branch on the code still can.
    let detail = body
    try {
      const j = JSON.parse(body) as { message?: string | string[] }
      const m = Array.isArray(j.message) ? j.message.join(' ') : j.message
      if (m) detail = m
    } catch {
      /* non-JSON error body — keep the raw text */
    }
    throw new Error(`API error ${res.status}: ${detail}`)
  }
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`API error ${res.status}: response was not valid JSON`)
  }
}

/**
 * Download ONE email attachment through the authenticated API. A bare `<a href>` can't be relied on
 * here (the httpOnly session cookie isn't guaranteed to ride a plain cross-origin navigation), so
 * fetch the bytes (with credentials) and hand the browser a blob.
 */
export async function downloadAttachment(attachmentId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}/emails/attachments/${encodeURIComponent(attachmentId)}/download`, {
    credentials: 'include',
  })
  if (!res.ok) {
    let detail = `download failed (${res.status})`
    try {
      const j = (await res.json()) as { message?: string | string[]; code?: string }
      const m = Array.isArray(j.message) ? j.message.join(' ') : j.message
      if (m) detail = m
      if (j.code === 'ATTACHMENT_UNAVAILABLE') {
        detail =
          m ||
          'Attachment unavailable: mailbox/Graph re-fetch failed, or MIME file was never stored at match time.'
      }
    } catch {
      /* keep status detail */
    }
    throw new Error(detail)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Row shape returned by GET /api/documents (the "Unlinked Documents" review inbox). */
export interface DocumentRow {
  id: string
  customer: string | null
  emailType: string | null
  senderType: string | null
  poNumbers: string[]
  poCount: number
  qty: number | null
  qtyUnit: string | null
  receivedAt: string | null
}

/** Detail shape returned by GET /api/documents/:id (the inspect drawer). Adds the source-email
 *  linkage (`emailId`, nullable when the document has no backing queue message). */
export interface DocumentDetail {
  id: string
  customer: string | null
  emailType: string | null
  senderType: string | null
  poNumbers: string[]
  poCount: number
  qty: number | null
  qtyUnit: string | null
  receivedAt: string | null
  emailId: string | null
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  // --- Unlinked Documents (orphan invoice/misc emails) ---
  getDocuments: () =>
    request<{ documents: DocumentRow[] }>('/documents').then((r) => r.documents),
  getDocument: (id: string) => request<DocumentDetail>(`/documents/${id}`),
  linkDocument: (id: string, shipmentId: string) =>
    request<{ ok: true }>(`/documents/${id}/link`, {
      method: 'POST',
      body: JSON.stringify({ shipmentId }),
    }),
  dismissDocument: (id: string) =>
    request<{ ok: true }>(`/documents/${id}/dismiss`, { method: 'POST' }),
}
