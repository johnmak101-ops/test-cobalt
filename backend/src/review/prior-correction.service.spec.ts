import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PriorCorrectionService } from './prior-correction.service'
import type { MastersRepository } from '../db/repositories/masters.repository'

/**
 * The raw-name → master-code fact an operator's correction leaves behind.
 *
 * It is a RETRIEVAL BOOST, never a resolver: `POST /masters/candidates` ranks that code higher and the
 * LLM still decides every time (design decision D — no deterministic fast-path). That is the whole
 * difference between teaching the model and hard-coding around it, so the two refusals below matter as
 * much as the write: each one is a mapping that would have been confidently wrong forever.
 *
 * Extracted from ReviewQueueService because only ONE of the three surfaces an operator can fix a party
 * from recorded anything — and the silent two include Order Details, the screen they actually use.
 */
const CODES = {
  customer: new Set(['TLB']),
  vendor: new Set(['ZEFENG', 'MACFUN', 'ROKNFT']),
  forwarder: new Set(['RHNKH', 'DSVKH']),
  port: new Set(['CNSZX', 'USNYC']),
}

let facts: { kind: string; lhs: string; rhs: string | null; reason: string | null; createdBy: string | null }[]
let deactivated: { kind: string; lhs: string }[]

const masters = {
  customerByCode: vi.fn(async (c: string) => (CODES.customer.has(c.toUpperCase()) ? { id: 'x', code: c, name: 'n' } : null)),
  vendorIdByCode: vi.fn(async (c: string) => (CODES.vendor.has(c.toUpperCase()) ? 'vid' : null)),
  forwarderIdByCode: vi.fn(async (c: string) => (CODES.forwarder.has(c.toUpperCase()) ? 'fid' : null)),
  portIdByUnlocode: vi.fn(async (c: string) => (CODES.port.has(c.toUpperCase()) ? 'pid' : null)),
  deactivateActiveFor: vi.fn(async (kind: string, lhs: string) => void deactivated.push({ kind, lhs })),
  insertOpsFact: vi.fn(async (v: { kind: string; lhs: string; rhs: string | null; reason: string | null; createdBy: string | null }) => void facts.push(v)),
}

const svc = () => new PriorCorrectionService(masters as unknown as MastersRepository)

beforeEach(() => {
  facts = []
  deactivated = []
  vi.clearAllMocks()
})

describe('PriorCorrectionService — a raw name the master could not answer', () => {
  it('records the operator’s answer as a prior_correction fact', async () => {
    expect(await svc().recordFromLegEdit('forwarderRaw', 'DSV Air & Sea', 'DSVKH', 'u1')).toBe('recorded')
    expect(facts).toEqual([
      { kind: 'prior_correction', lhs: 'DSV Air & Sea', rhs: 'DSVKH', reason: 'review correction (forwarderRaw)', createdBy: 'u1' },
    ])
  })

  it('supersedes the previous fact for that raw name — latest human word wins', async () => {
    await svc().recordFromLegEdit('forwarderRaw', 'DSV Air & Sea', 'DSVKH', 'u1')
    expect(deactivated).toEqual([{ kind: 'prior_correction', lhs: 'DSV Air & Sea' }])
  })

  it('upper-cases the code but stores the raw name EXACTLY as the email wrote it', async () => {
    await svc().recordFromLegEdit('vendorRaw', '中山市南朗镇泽锋针织有限公司', ' zefeng ', 'u1')
    expect(facts[0]).toMatchObject({ lhs: '中山市南朗镇泽锋针织有限公司', rhs: 'ZEFENG' })
  })
})

describe('PriorCorrectionService — the two refusals', () => {
  it('🔴 refuses when the OLD value is already a master code — that is a reading error, not a lookup', async () => {
    // The matcher confidently resolved MACFUN; the operator says ROKNFT. Both are real. Storing
    // `MACFUN → ROKNFT` would redirect every future email that legitimately names MACFUN, using one
    // mistake to manufacture unlimited others. The raw name that caused it is already gone from the
    // field by the time the operator sees it, so there is nothing here to bind.
    expect(await svc().recordFromLegEdit('vendorRaw', 'MACFUN', 'ROKNFT', 'u1')).toBe('skipped')
    expect(facts).toEqual([])
  })

  it('🔴 refuses when the NEW value is in no master — that is a master-data gap, not a hint', async () => {
    expect(await svc().recordFromLegEdit('forwarderRaw', 'DSV Air & Sea', 'DSV001', 'u1')).toBe('skipped')
    expect(facts).toEqual([])
  })

  it('is scoped BY KIND — a real vendor code is not a real forwarder code', async () => {
    expect(await svc().recordFromLegEdit('forwarderRaw', 'Some Forwarder', 'ZEFENG', 'u1')).toBe('skipped')
  })

  it('skips an empty side and a no-op edit (case-insensitively)', async () => {
    expect(await svc().recordFromLegEdit('forwarderRaw', '', 'DSVKH', 'u1')).toBe('skipped')
    expect(await svc().recordFromLegEdit('forwarderRaw', 'DSV Air & Sea', '', 'u1')).toBe('skipped')
    expect(await svc().recordFromLegEdit('forwarderRaw', 'dsvkh', 'DSVKH', 'u1')).toBe('skipped')
    expect(facts).toEqual([])
  })
})

describe('PriorCorrectionService — which columns it listens to', () => {
  it('covers the five party/port columns, in the leg vocabulary Order Details edits use', async () => {
    expect(await svc().recordFromLegEdit('customerRaw', 'The Talbots Inc', 'TLB', 'u1')).toBe('recorded')
    expect(await svc().recordFromLegEdit('vendorRaw', 'Ze Feng Knitting', 'ZEFENG', 'u1')).toBe('recorded')
    expect(await svc().recordFromLegEdit('forwarderRaw', 'Rhenus Cambodia', 'RHNKH', 'u1')).toBe('recorded')
    expect(await svc().recordFromLegEdit('polRaw', 'Shenzhen', 'CNSZX', 'u1')).toBe('recorded')
    expect(await svc().recordFromLegEdit('podRaw', 'New York', 'USNYC', 'u1')).toBe('recorded')
  })

  it('ignores every other column without asking the master anything — most edits are dates and counts', async () => {
    for (const col of ['etd', 'qty', 'bookingNo', 'consigneeName', 'vesselName']) {
      expect(await svc().recordFromLegEdit(col, 'a', 'b', 'u1')).toBe('skipped')
    }
    expect(masters.portIdByUnlocode).not.toHaveBeenCalled()
    expect(masters.customerByCode).not.toHaveBeenCalled()
  })

  it('reads the review-queue verdict form too (parser vocabulary, both maps at once)', async () => {
    await svc().recordFromExtraction(
      { customer_code: 'The Talbots Inc', vendor_code: 'MACFUN', pol: 'Shenzhen' },
      { customer_code: 'TLB', vendor_code: 'ROKNFT', pol: 'CNSZX' },
      'u1',
    )
    // customer + pol qualify; the vendor swap is real-code→real-code and is refused
    expect(facts.map((f) => f.rhs)).toEqual(['TLB', 'CNSZX'])
  })
})

describe('PriorCorrectionService — never sinks the edit that produced it', () => {
  it('swallows a repository failure and reports skipped', async () => {
    masters.insertOpsFact.mockRejectedValueOnce(new Error('deadlock'))
    expect(await svc().recordFromLegEdit('forwarderRaw', 'DSV Air & Sea', 'DSVKH', 'u1')).toBe('skipped')
  })
})
