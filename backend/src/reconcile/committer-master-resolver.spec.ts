import { describe, it, expect, vi } from 'vitest'
import { aliasMapsFromFacts, MasterResolver } from './committer-master-resolver'

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

  it('port_alias fact: CHATTOGRAM → BDCGP port id via pre-lookup', async () => {
    const masters = {
      portLinkByCodeOrName: vi.fn(async (code: string) =>
        code === 'BDCGP' ? { id: 'port-cgp', country: 'BD', tier: 'unlocode_exact' as const } : null,
      ),
      forwarderIdByCode: vi.fn(async () => null),
      forwarderLinkByName: vi.fn(async () => null),
      canonicalCode: vi.fn(async (c: string) => c),
      customerIdByCode: vi.fn(async () => null),
      vendorIdByCode: vi.fn(async () => null),
    }
    const r = new MasterResolver(masters as never)
    const aliases = {
      portAlias: new Map([['CHATTOGRAM', 'BDCGP']]),
      forwarderAlias: new Map<string, string>(),
    }
    const out = await r.resolveAll({ pol: 'CHATTOGRAM' }, aliases)
    expect(out.polLink?.id).toBe('port-cgp')
    expect(masters.portLinkByCodeOrName).toHaveBeenCalledWith('BDCGP', undefined)
  })

  it('aliasMapsFromFacts stows the fact rows; resolvePortLink hands them through (no per-call re-fetch)', async () => {
    const facts = [
      { kind: 'port_alias', lhs: 'CHATTOGRAM', rhs: 'BDCGP' },
      { kind: 'port_abbreviation', lhs: 'HKG', rhs: 'HKHKG' },
      { kind: 'forwarder_alias', lhs: 'VENA SAIL', rhs: 'VENA' },
    ]
    const aliases = aliasMapsFromFacts(facts)
    expect(aliases.portFacts).toBe(facts)
    const masters = { portLinkByCodeOrName: vi.fn(async () => null) }
    const r = new MasterResolver(masters as never)
    await r.resolvePortLink('SOMEWHERE', aliases)
    expect(masters.portLinkByCodeOrName).toHaveBeenCalledWith('SOMEWHERE', facts)
  })

  it('forwarder_alias fact: raw name → code_exact link', async () => {
    const masters = {
      forwarderIdByCode: vi.fn(async (c: string) => (c === 'VENA' ? 'fwd-vena' : null)),
      forwarderLinkByName: vi.fn(async () => null),
      portLinkByCodeOrName: vi.fn(async () => null),
      canonicalCode: vi.fn(async (c: string) => c),
      customerIdByCode: vi.fn(async () => null),
      vendorIdByCode: vi.fn(async () => null),
    }
    const r = new MasterResolver(masters as never)
    const aliases = {
      portAlias: new Map<string, string>(),
      forwarderAlias: new Map([['VENA SAIL (BD) SUPPLY CHAIN CO. LTD.', 'VENA']]),
    }
    const out = await r.resolveAll(
      { forwarder_name: 'VENA SAIL (BD) SUPPLY CHAIN CO. LTD.' },
      aliases,
    )
    expect(out.forwarderLink).toEqual({ id: 'fwd-vena', tier: 'code_exact' })
    expect(masters.forwarderLinkByName).not.toHaveBeenCalled()
  })

  it('no alias fact → behavior unchanged (still unlinked when no exact match)', async () => {
    const masters = {
      forwarderIdByCode: vi.fn(async () => null),
      forwarderLinkByName: vi.fn(async () => null),
      portLinkByCodeOrName: vi.fn(async () => null),
      canonicalCode: vi.fn(async (c: string) => c),
      customerIdByCode: vi.fn(async () => null),
      vendorIdByCode: vi.fn(async () => null),
    }
    const r = new MasterResolver(masters as never)
    const out = await r.resolveAll({ forwarder_name: 'UNKNOWN CO', pol: 'NOWHERE' })
    expect(out.forwarderLink).toEqual({ id: null, tier: null })
    expect(out.polLink).toBeNull()
  })
})
