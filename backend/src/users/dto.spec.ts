import { describe, it, expect } from 'vitest'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { CreateUserDto } from './dto'

const errs = (o: unknown) => validateSync(plainToInstance(CreateUserDto, o))

describe('CreateUserDto password policy', () => {
  const base = { email: 'a@b.com', name: 'A', role: 'VIEWER' }
  it('accepts an 8-char password', () => {
    expect(errs({ ...base, password: 'abcd1234' })).toHaveLength(0)
  })
  it('rejects a 4-char password', () => {
    expect(errs({ ...base, password: 'abcd' }).length).toBeGreaterThan(0)
  })
})
