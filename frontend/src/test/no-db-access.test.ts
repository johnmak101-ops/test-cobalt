import { describe, it, expect } from 'vitest'

// Read every frontend source file as a raw string at build time (Vite/vitest feature).
const modules = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: 'pg driver import', re: /from\s+['"]pg['"]/ },
  { label: 'drizzle-orm import', re: /from\s+['"]drizzle-orm['"]/ },
  { label: 'postgres connection string', re: /postgres(?:ql)?:\/\// },
  { label: 'DATABASE_URL reference', re: /\bDATABASE_URL\b/ },
  { label: 'non-VITE env secret', re: /import\.meta\.env\.(?!DEV\b|PROD\b|MODE\b|BASE_URL\b|SSR\b|VITE_)[A-Za-z_]+/ },
]

describe('frontend never accesses the database or holds secrets', () => {
  const entries = Object.entries(modules).filter(([p]) => !p.includes('no-db-access.test'))
  it('scans the whole src tree', () => expect(entries.length).toBeGreaterThan(20))
  for (const [path, source] of entries) {
    it(`${path} has no DB access or secret reference`, () => {
      for (const { label, re } of FORBIDDEN) {
        expect(source, `${path} must not contain ${label}`).not.toMatch(re)
      }
    })
  }
})
