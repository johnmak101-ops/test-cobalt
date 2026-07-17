import { describe, it, expect } from 'vitest'
import { Reflector } from '@nestjs/core'
import { MastersController } from './masters.controller'
import { ROLES_KEY } from '../auth/decorators'
import { PAGE_READ_KEY, PAGE_WRITE_KEY } from '../access/page-access.decorators'

const reflector = new Reflector()
const write = (m: keyof MastersController) => reflector.get<string>(PAGE_WRITE_KEY, MastersController.prototype[m])
const read = (m: keyof MastersController) => reflector.get<string>(PAGE_READ_KEY, MastersController.prototype[m])
const roles = (m: keyof MastersController) => reflector.get<string[]>(ROLES_KEY, MastersController.prototype[m])

describe('MastersController — Resolution Rules access retrofit', () => {
  it('resolution WRITES require Edit on resolution_rules (was @Roles ADMIN)', () => {
    for (const m of ['createFact', 'patchFact', 'deactivateFact', 'reactivateFact', 'curate', 'approveProposal', 'rejectProposal'] as const) {
      expect(write(m)).toBe('resolution_rules')
      expect(roles(m)).toBeUndefined() // no residual static @Roles
    }
  })

  it('resolution management READS require View on resolution_rules', () => {
    expect(read('resolutionManage')).toBe('resolution_rules')
    expect(read('proposals')).toBe('resolution_rules')
  })

  it('the consumer read GET /masters/resolution stays UNGATED (cobalt-queue reads it)', () => {
    expect(read('resolution')).toBeUndefined()
    expect(write('resolution')).toBeUndefined()
    expect(roles('resolution')).toBeUndefined()
  })

  it('non-matrix masters (forwarders/ports/consignees) keep static @Roles(ADMIN)', () => {
    for (const m of ['createForwarder', 'createPort', 'createConsignee'] as const) {
      expect(roles(m)).toEqual(['ADMIN'])
      expect(write(m)).toBeUndefined()
    }
  })

  it('POST /masters/sync is ADMIN-only (#161)', () => {
    expect(roles('syncNow')).toEqual(['ADMIN'])
  })

  it('POST /masters/ports/sync is ADMIN-only (#159)', () => {
    expect(roles('syncPortsNow')).toEqual(['ADMIN'])
  })
})
