import { describe, it, expect } from 'vitest'
import { mapCustomer, mapVendor, mapForwarder, MeshClient } from './mesh.client'

describe('mesh mappers', () => {
  it('maps an active customer (incl. country/email/address enrichment); drops inactive; falls back name→code', () => {
    expect(
      mapCustomer({ CustomerCode: '2TAL', FullNameEn: '2TALL.COM RETAIL LIMITED ', FullNameCh: '', CountryName: 'United Kingdom', Email: 'buy@2tall.com ', Address: '1 High St', IsActive: true }),
    ).toEqual({ code: '2TAL', name: '2TALL.COM RETAIL LIMITED', country: 'United Kingdom', contactEmail: 'buy@2tall.com', address: '1 High St', nameCh: null })
    // missing enrichment fields → nulls (Mesh rows vary)
    expect(mapCustomer({ CustomerCode: 'X', FullNameEn: '', FullNameCh: '', IsActive: true })).toEqual({ code: 'X', name: 'X', country: null, contactEmail: null, address: null, nameCh: null })
    expect(mapCustomer({ CustomerCode: 'X', FullNameEn: 'Y', IsActive: false })).toBeNull()
  })
  it('maps a factory and a gmtsupplier to vendor rows with the right type', () => {
    expect(mapVendor({ FactoryCode: 'AAGLLT', FullNameEn: 'AA GLOBAL LTD', FullNameCh: '雙A環球有限公司', CountryName: 'Taiwan', Email: '', Phone: '', IsActive: true }, 'factory', 'FactoryCode'))
      .toEqual({ code: 'AAGLLT', name: 'AA GLOBAL LTD', type: 'factory', location: 'Taiwan', contactEmail: null, contactPhone: null, nameCh: '雙A環球有限公司' })
    expect(mapVendor({ GmtSuppCode: 'ABLSUC', FullNameEn: 'ABLE SUCCESS LIMITED', CountryName: 'China', IsActive: true }, 'agent', 'GmtSuppCode')?.type).toBe('agent')
  })
  it('maps an active forwarder; drops inactive (Active flag)', () => {
    expect(mapForwarder({ ForwarderCode: '001', ForwarderName: 'ITALSEMPIONE S.P.A', Active: true })).toEqual({ code: '001', name: 'ITALSEMPIONE S.P.A' })
    expect(mapForwarder({ ForwarderCode: '002', ForwarderName: 'X', Active: false })).toBeNull()
  })
})

describe('MeshClient', () => {
  const cfg = { baseUrl: 'https://h/api', tenantId: 't', clientId: 'c', clientSecret: 's', scope: 'sc' }
  function fakeFetch(routes: Record<string, unknown>) {
    const calls: string[] = []
    const fn = async (url: string) => {
      calls.push(url)
      if (url.includes('/oauth2/v2.0/token')) return { ok: true, json: async () => ({ access_token: 'TOK', expires_in: 3600 }) } as unknown as Response
      const path = url.replace(cfg.baseUrl, '')
      return { ok: true, json: async () => routes[path] ?? [] } as unknown as Response
    }
    return { fn, calls }
  }

  it('fetches a token then GETs with Bearer, and caches the token across calls', async () => {
    const { fn, calls } = fakeFetch({ '/ShipTrack/customers': [{ CustomerCode: 'A', FullNameEn: 'Acme', IsActive: true }] })
    const c = new MeshClient(cfg, fn as unknown as typeof fetch)
    expect(await c.customers()).toEqual([{ code: 'A', name: 'Acme', country: null, contactEmail: null, address: null, nameCh: null }])
    await c.customers()
    expect(calls.filter((u) => u.includes('/oauth2/')).length).toBe(1) // token cached
    expect(calls.some((u) => u === 'https://h/api/ShipTrack/customers')).toBe(true)
  })

  it('vendors() unions factories + gmtsuppliers', async () => {
    const { fn } = fakeFetch({
      '/ShipTrack/factories': [{ FactoryCode: 'F1', FullNameEn: 'Fac', CountryName: 'CN', IsActive: true }],
      '/ShipTrack/gmtsuppliers': [{ GmtSuppCode: 'G1', FullNameEn: 'Sup', CountryName: 'CN', IsActive: true }],
    })
    const rows = await new MeshClient(cfg, fn as unknown as typeof fetch).vendors()
    expect(rows.map((r) => `${r.code}:${r.type}`).sort()).toEqual(['F1:factory', 'G1:agent'])
  })

  it('vendors() dedupes a shared factory+gmtsupplier code — one row per code, factory wins', async () => {
    // a company can be BOTH a factory and a gmtsupplier; vendors is one row per code, so combining the two
    // sources must not spawn a duplicate (which also made the sync non-idempotent — the smoke caught it).
    const { fn } = fakeFetch({
      '/ShipTrack/factories': [{ FactoryCode: 'DUAL', FullNameEn: 'Dual Co', CountryName: 'CN', IsActive: true }],
      '/ShipTrack/gmtsuppliers': [{ GmtSuppCode: 'DUAL', FullNameEn: 'Dual Co', CountryName: 'CN', IsActive: true }],
    })
    const rows = await new MeshClient(cfg, fn as unknown as typeof fetch).vendors()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: 'DUAL', type: 'factory' })
  })
})
