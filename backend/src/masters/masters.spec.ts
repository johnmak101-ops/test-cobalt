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

type Majority = { cust: string; consignee: string | null; vendor: string | null; n: number }

function curatorRepo(opts: { majorities: Majority[]; approved?: string[] }) {
  const created: { kind: string; lhs: string; rhs: string | null }[] = []
  const statusCalls: { id: string; status: string; reviewer: string }[] = []
  const listCalls: string[] = []
  const repo = {
    evidenceMajorities: async () => opts.majorities,
    approvedKeys: async () => new Set(opts.approved ?? []),
    createProposal: async (v: { kind: string; lhs: string; rhs: string | null }) => {
      created.push({ kind: v.kind, lhs: v.lhs, rhs: v.rhs })
      return { id: `prop-${created.length}`, ...v }
    },
    setProposalStatus: async (id: string, status: string, reviewer: string) => {
      statusCalls.push({ id, status, reviewer })
      return { id, status }
    },
    listResolution: async (status: string) => {
      listCalls.push(status)
      return [{ id: 'r1', status }]
    },
  }
  return { svc: new MastersService(repo as unknown as MastersRepository), created, statusCalls, listCalls }
}

describe('MastersService — curator (majority-vote proposals)', () => {
  it('proposes the dominant consignee AND vendor for a customer when each clears the >=3 threshold', async () => {
    const { svc, created } = curatorRepo({
      majorities: [{ cust: 'DOCC', consignee: 'DOCLASSE CO., LTD', vendor: 'ROKNFT', n: 5 }],
    })
    const res = await svc.curate()
    expect(res.proposed).toBe(2)
    expect(created).toContainEqual({ kind: 'consignee_for_customer', lhs: 'DOCC', rhs: 'DOCLASSE CO., LTD' })
    expect(created).toContainEqual({ kind: 'customer_vendor', lhs: 'DOCC', rhs: 'ROKNFT' })
  })

  it('aggregates counts across rows and picks the single dominant value per field', async () => {
    const { svc, created } = curatorRepo({
      majorities: [
        { cust: 'WYSE', consignee: 'WYSE LONDON', vendor: 'MACFUN', n: 2 },
        { cust: 'WYSE', consignee: 'WYSE LONDON', vendor: 'OTHER', n: 2 },
      ],
    })
    const res = await svc.curate()
    // consignee WYSE LONDON = 4 (>=3) -> proposed; vendor top is 2 (<3) -> skipped
    expect(res.proposed).toBe(1)
    expect(created).toEqual([{ kind: 'consignee_for_customer', lhs: 'WYSE', rhs: 'WYSE LONDON' }])
  })

  it('does not propose anything below the >=3 evidence threshold', async () => {
    const { svc, created } = curatorRepo({
      majorities: [{ cust: 'ELGC', consignee: 'STRAUSS', vendor: 'ELSMCO', n: 2 }],
    })
    const res = await svc.curate()
    expect(res.proposed).toBe(0)
    expect(created).toEqual([])
  })

  it('skips a fact that is already approved (case-insensitive key match)', async () => {
    const { svc, created } = curatorRepo({
      majorities: [{ cust: 'docc', consignee: 'DOCLASSE CO., LTD', vendor: 'ROKNFT', n: 5 }],
      approved: ['consignee_for_customer:DOCC'],
    })
    const res = await svc.curate()
    // consignee is already approved (DOCC upper) -> only the vendor is proposed
    expect(res.proposed).toBe(1)
    expect(created).toEqual([{ kind: 'customer_vendor', lhs: 'docc', rhs: 'ROKNFT' }])
  })
})

describe('MastersService — proposals loop delegation', () => {
  it('approveProposal / rejectProposal set the proposal status with the actor', async () => {
    const { svc, statusCalls } = curatorRepo({ majorities: [] })
    await svc.approveProposal('p1', 'user-1')
    await svc.rejectProposal('p2', 'user-2')
    expect(statusCalls).toEqual([
      { id: 'p1', status: 'approved', reviewer: 'user-1' },
      { id: 'p2', status: 'rejected', reviewer: 'user-2' },
    ])
  })

  it('resolution() lists approved facts and proposals() lists proposed', async () => {
    const { svc, listCalls } = curatorRepo({ majorities: [] })
    await svc.resolution()
    await svc.proposals()
    expect(listCalls).toEqual(['approved', 'proposed'])
  })
})
