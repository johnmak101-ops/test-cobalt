import { describe, it, expect, vi } from 'vitest'
import { MasterResolver } from './committer-master-resolver'

describe('MasterResolver', () => {
  it('resolveCustomer uses canonical then falls back to original code', async () => {
    const masters = {
      canonicalCode: vi.fn(async (c: string) => (c.toUpperCase() === 'COLEB' ? 'COLE' : c.toUpperCase())),
      customerIdByCode: vi.fn(async (c: string) => (c === 'COLE' ? 'id-cole' : null)),
    }
    const r = new MasterResolver(masters as never)
    expect(await r.resolveCustomer('COLEB')).toBe('id-cole')
    expect(masters.canonicalCode).toHaveBeenCalledWith('COLEB')
  })

  it('resolveCustomer Hole-2: falls back when canonical has no master row', async () => {
    const masters = {
      canonicalCode: vi.fn(async () => 'MISSING'),
      customerIdByCode: vi.fn(async (c: string) => (c.toUpperCase() === 'RAW' ? 'id-raw' : null)),
    }
    const r = new MasterResolver(masters as never)
    expect(await r.resolveCustomer('raw')).toBe('id-raw')
  })

  it('resolveForwarderLink prefers code_exact over name tiers', async () => {
    const masters = {
      forwarderIdByCode: vi.fn(async () => 'fwd-1'),
      forwarderLinkByName: vi.fn(async () => ({ id: 'fwd-name', tier: 'name_exact' as const })),
    }
    const r = new MasterResolver(masters as never)
    expect(await r.resolveForwarderLink('DSV')).toEqual({ id: 'fwd-1', tier: 'code_exact' })
    expect(masters.forwarderLinkByName).not.toHaveBeenCalled()
  })

  it('resolveAll fans out customer/vendor/forwarder/ports', async () => {
    const masters = {
      canonicalCode: vi.fn(async (c: string) => c.toUpperCase()),
      customerIdByCode: vi.fn(async () => 'c1'),
      vendorIdByCode: vi.fn(async () => 'v1'),
      forwarderIdByCode: vi.fn(async () => null),
      forwarderLinkByName: vi.fn(async () => ({ id: 'f1', tier: 'name_exact' as const })),
      portLinkByCodeOrName: vi.fn(async (code: string) =>
        code === 'CNSHA' ? { id: 'p-sha', country: 'CN', tier: 'unlocode_exact' as const } : { id: 'p-hkg', country: 'HK', tier: 'unlocode_exact' as const },
      ),
    }
    const r = new MasterResolver(masters as never)
    const out = await r.resolveAll({
      customer_code: 'WYSE',
      vendor_code: 'MACFUN',
      forwarder_name: 'DSV AIR',
      pol: 'CNSHA',
      pod: 'HKHKG',
    })
    expect(out.customerId).toBe('c1')
    expect(out.vendorId).toBe('v1')
    expect(out.forwarderLink).toEqual({ id: 'f1', tier: 'name_exact' })
    expect(out.polLink?.id).toBe('p-sha')
    expect(out.podLink?.id).toBe('p-hkg')
  })
})
