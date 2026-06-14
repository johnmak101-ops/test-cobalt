import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password', () => {
  it('hashes (not reversible) and verifies the right password', async () => {
    const hash = await hashPassword('s3cret!')
    expect(hash).not.toBe('s3cret!')
    expect(await verifyPassword('s3cret!', hash)).toBe(true)
  })
  it('rejects the wrong password', async () => {
    const hash = await hashPassword('s3cret!')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})
