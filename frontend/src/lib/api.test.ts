import { describe, it, expect } from 'vitest'
import { resolveApiBase } from './api'

const at = (hostname: string, port: string) => resolveApiBase({ hostname, port }, '3000')

describe('resolveApiBase', () => {
  it('prod HTTPS host on the implicit :443 (port "") → same-origin /api', () => {
    // The regression this guards: a port-only check sent this to http://localhost:3000/api.
    expect(at('statustrack.cobaltknitwear.com', '')).toBe('/api')
  })

  it('intranet access by bare IP → same-origin /api', () => {
    expect(at('10.104.20.18', '')).toBe('/api')
  })

  it('Vite dev server on :5173 → proxied /api', () => {
    expect(at('localhost', '5173')).toBe('/api')
  })

  it('backend-served SPA on :3000 → /api', () => {
    expect(at('localhost', '3000')).toBe('/api')
  })

  it('SPA on a different LOCAL port (PAVE/dev) → absolute backend on localhost', () => {
    expect(at('localhost', '4000')).toBe('http://localhost:3000/api')
    expect(at('127.0.0.1', '4321')).toBe('http://localhost:3000/api')
  })
})
