import { describe, it, expect } from 'vitest'
import { validateEnv } from './env.validation'

describe('validateEnv', () => {
  it('accepts a valid JWT_SECRET (>=32 chars) and returns the parsed env', () => {
    expect(validateEnv({ JWT_SECRET: 'x'.repeat(32) }).JWT_SECRET).toHaveLength(32)
  })
  it('throws when JWT_SECRET is missing', () => {
    expect(() => validateEnv({})).toThrow(/JWT_SECRET/)
  })
  it('throws when JWT_SECRET is too short', () => {
    expect(() => validateEnv({ JWT_SECRET: 'short' })).toThrow(/at least 32/)
  })
})
