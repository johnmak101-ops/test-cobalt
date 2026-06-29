import { describe, it, expect } from 'vitest'
import { cookieTokenExtractor } from './cookie-extractor'

const req = (cookie?: string) => ({ headers: cookie === undefined ? {} : { cookie } })

describe('cookieTokenExtractor — read JWT from the session cookie', () => {
  it('extracts the session token when it is the only cookie', () => {
    expect(cookieTokenExtractor(req('session=abc123'))).toBe('abc123')
  })

  it('extracts the session token from among several cookies', () => {
    expect(cookieTokenExtractor(req('foo=1; session=abc123; bar=2'))).toBe('abc123')
  })

  it('URL-decodes the value', () => {
    expect(cookieTokenExtractor(req('session=a%20b'))).toBe('a b')
  })

  it('returns null when the session cookie is absent', () => {
    expect(cookieTokenExtractor(req('foo=1; bar=2'))).toBeNull()
  })

  it('returns null when there is no cookie header at all', () => {
    expect(cookieTokenExtractor(req())).toBeNull()
    expect(cookieTokenExtractor(null)).toBeNull()
    expect(cookieTokenExtractor(undefined)).toBeNull()
  })

  it('honors a custom cookie name', () => {
    expect(cookieTokenExtractor(req('jwt=xyz'), 'jwt')).toBe('xyz')
  })
})
