import { describe, it, expect } from 'vitest'
import { validateSync } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { ChangePasswordDto } from './dto'

const errors = (obj: unknown) => validateSync(plainToInstance(ChangePasswordDto, obj))

describe('ChangePasswordDto', () => {
  it('accepts an 8+ char new password', () => {
    expect(errors({ currentPassword: 'x', newPassword: 'abcd1234' })).toHaveLength(0)
  })
  it('rejects a new password shorter than 8', () => {
    expect(errors({ currentPassword: 'x', newPassword: 'short' }).length).toBeGreaterThan(0)
  })
  it('rejects a missing current password', () => {
    expect(errors({ newPassword: 'abcd1234' }).length).toBeGreaterThan(0)
  })
})
