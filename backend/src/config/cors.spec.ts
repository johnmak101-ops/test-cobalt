import { describe, it, expect } from 'vitest'
import { resolveCorsOrigins } from './cors'

describe('resolveCorsOrigins', () => {
  it('defaults to localhost dev origins + the prod URL when CORS_ORIGINS is unset', () => {
    const o = resolveCorsOrigins(undefined)
    expect(o).toContain('https://statustrackagent.cobaltknitwear.com')
    expect(o).toContain('http://localhost:5173')
    expect(o).toContain('http://localhost:3000')
  })
  it('parses and trims a comma-separated CORS_ORIGINS', () => {
    expect(resolveCorsOrigins('https://a.com, https://b.com')).toEqual(['https://a.com', 'https://b.com'])
  })
})
