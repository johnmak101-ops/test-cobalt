import { describe, it, expect } from 'vitest'
import { MastersService } from './masters.service'
import type { MastersRepository } from '../db/repositories/masters.repository'

function fakeRepo() {
  const calls: Record<string, unknown> = {}
  const repo = {
    createForwarder: (v: unknown) => ((calls.createForwarder = v), Promise.resolve(v)),
    updateForwarder: (id: string, p: unknown) => ((calls.updateForwarder = { id, p }), Promise.resolve(p)),
    createPort: (v: unknown) => ((calls.createPort = v), Promise.resolve(v)),
    updatePort: (id: string, p: unknown) => ((calls.updatePort = { id, p }), Promise.resolve(p)),
    createConsignee: (v: unknown) => ((calls.createConsignee = v), Promise.resolve(v)),
    updateConsignee: (id: string, p: unknown) => ((calls.updateConsignee = { id, p }), Promise.resolve(p)),
  }
  return { svc: new MastersService(repo as unknown as MastersRepository), calls }
}

describe('MastersService — normalization', () => {
  it('uppercases the UN/LOCODE and trims fields on port create', async () => {
    const { svc, calls } = fakeRepo()
    await svc.createPort({ unlocode: ' cnsha ', name: '  Shanghai ', country: 'CN', mode: 'sea' })
    expect(calls.createPort).toEqual({ unlocode: 'CNSHA', name: 'Shanghai', country: 'CN', mode: 'sea' })
  })

  it('turns empty strings into null on forwarder create', async () => {
    const { svc, calls } = fakeRepo()
    await svc.createForwarder({ code: '   ', name: 'GFS' })
    expect(calls.createForwarder).toEqual({ code: null, name: 'GFS' })
  })

  it('clears blank address / mapping on consignee create', async () => {
    const { svc, calls } = fakeRepo()
    await svc.createConsignee({ name: 'Acme', address: '', mapsToCustomerId: '' })
    expect(calls.createConsignee).toEqual({ name: 'Acme', address: null, mapsToCustomerId: null })
  })

  it('only patches provided fields on update (undefined keys are skipped)', async () => {
    const { svc, calls } = fakeRepo()
    await svc.updatePort('p1', { mode: 'air' })
    expect(calls.updatePort).toEqual({ id: 'p1', p: { mode: 'air' } })
  })

  it('normalizes provided update fields (trim → null)', async () => {
    const { svc, calls } = fakeRepo()
    await svc.updateConsignee('c1', { name: '  New Co ', address: '  ' })
    expect(calls.updateConsignee).toEqual({ id: 'c1', p: { name: 'New Co', address: null } })
  })
})
