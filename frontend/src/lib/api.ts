// Vite dev (5173) proxies /api → backend; backend (3000) serves /api directly;
// PAVE / other origins hit the backend absolutely.
const backendPort: string = (import.meta as any).env?.VITE_BACKEND_PORT ?? '3000'

const API_BASE =
  window.location.port === '5173'
    ? '/api' // Vite dev server — it proxies /api
    : window.location.port === '3000'
      ? '/api' // Backend serving static files
      : `http://localhost:${backendPort}/api` // PAVE or other — hit backend directly

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let token: string | null = null
  try {
    token = localStorage.getItem('cobalt_token')
  } catch {
    /* ignore */
  }
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include', // send the httpOnly session cookie
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), // belt-and-suspenders for proxied cookies
      ...options?.headers,
    },
    ...options,
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`API error ${res.status}: ${error}`)
  }

  // tolerate empty bodies (e.g. 204 / no-content from action endpoints)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
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
