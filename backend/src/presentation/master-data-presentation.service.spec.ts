import { describe, it, expect } from 'vitest'
import { MasterDataPresentationService } from './master-data-presentation.service'

const build = (over: Record<string, unknown> = {}) => {
  const mastersRepo = {
    listVendors: async () => [{ id: 'v1', code: 'ROKNFT', name: 'Rose Knit' }],
    listForwarders: async () => [{ id: 'f1', code: 'FAIR', name: 'Fairate' }],
    listCustomers: async () => [{ id: 'c1', code: 'COLE', name: 'Cole Haan' }],
    listConsignees: async () => [{ id: 'g1', name: 'Acme Consignee', address: '1 Dock Rd' }],
    ...over,
  }
  return new MasterDataPresentationService(mastersRepo as any)
}

describe('MasterDataPresentationService.vendors', () => {
  it('filters vendors by query (case-insensitive, code or name) and shapes the ref', async () => {
    expect((await build().vendors('rose')).vendors).toEqual([
      { id: 'v1', name: 'Rose Knit', code: 'ROKNFT', type: 'factory', location: null, contactEmail: null, contactPhone: null, notes: null, createdAt: null, updatedAt: null },
    ])
    expect((await build().vendors('ROKN')).vendors).toHaveLength(1)
    expect((await build().vendors('zzz')).vendors).toHaveLength(0)
    expect((await build().vendors()).vendors).toHaveLength(1)
  })
})

describe('MasterDataPresentationService.forwarders/customers/consignees', () => {
  it('shapes forwarder refs and filters by query', async () => {
    expect((await build().forwarders('fair')).forwarders).toEqual([{ id: 'f1', name: 'Fairate', code: 'FAIR' }])
    expect((await build().forwarders('zzz')).forwarders).toHaveLength(0)
  })
  it('shapes consignee rows with address', async () => {
    const { consignees } = await build().consignees()
    expect(consignees).toEqual([{ id: 'g1', name: 'Acme Consignee', address: '1 Dock Rd' }])
  })
})
