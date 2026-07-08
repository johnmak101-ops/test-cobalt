import { describe, it, expect } from 'vitest'
import { PageAccessController } from './page-access.controller'
import { ROLES_KEY } from '../auth/decorators'

describe('PageAccessController authz', () => {
  it('GET /page-access/me is open to any authenticated user (no role requirement)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PageAccessController.prototype.me)).toBeUndefined()
  })
  it('GET /page-access (the matrix) is SUPERADMIN-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PageAccessController.prototype.matrix)).toEqual(['SUPERADMIN'])
  })
  it('PUT /page-access (set) is SUPERADMIN-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, PageAccessController.prototype.set)).toEqual(['SUPERADMIN'])
  })
})
