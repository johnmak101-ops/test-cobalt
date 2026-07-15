/**
 * MasterResolver — stateful collaborator extracted from CommitterService.
 * Resolves customer / vendor / forwarder / port codes→ids (and forwarder/port link tiers for shadow metering).
 * All I/O goes through MastersRepository; no shipment/booking writes.
 *
 * Optional curated alias maps (loaded once per apply) pre-translate raw → rhs before exact resolution.
 * Exact-only: no substring/fuzzy on the alias step (#145).
 */
import { MastersRepository, type ForwarderLinkTier, type PortLinkTier } from '../db/repositories/masters.repository'
import { str } from './match-keys'

export type ForwarderLink = { id: string | null; tier: ForwarderLinkTier | null }
export type PortLink = { id: string; country: string | null; tier: PortLinkTier }

/** Normalized raw → rhs (UN/LOCODE or forwarder code). Keys must be uppercase. */
export type CuratedAliasMaps = {
  portAlias: Map<string, string>
  forwarderAlias: Map<string, string>
}

export function emptyAliasMaps(): CuratedAliasMaps {
  return { portAlias: new Map(), forwarderAlias: new Map() }
}

/** Build alias maps from approved master_resolution rows (port_alias + forwarder_alias). */
export function aliasMapsFromFacts(
  facts: Array<{ kind: string; lhs: string; rhs: string | null }>,
): CuratedAliasMaps {
  const maps = emptyAliasMaps()
  for (const f of facts) {
    if (!f.lhs || !f.rhs) continue
    const lhs = f.lhs.trim().toUpperCase()
    const rhs = f.rhs.trim().toUpperCase()
    if (!lhs || !rhs) continue
    if (f.kind === 'port_alias') maps.portAlias.set(lhs, rhs)
    else if (f.kind === 'forwarder_alias') maps.forwarderAlias.set(lhs, rhs)
  }
  return maps
}

export class MasterResolver {
  constructor(private readonly masters: MastersRepository) {}

  async resolveCustomer(code: unknown): Promise<string | null> {
    const c = str(code)
    if (!c) return null
    // canonical-aware: COLEB silently resolves to COLE's id. A canonical fact must never NULL an otherwise
    // -resolvable customer, so fall back to the original code when the canonical has no master row (Hole-2 guard).
    const canon = await this.masters.canonicalCode(c)
    return (await this.masters.customerIdByCode(canon)) ?? (canon !== c.toUpperCase() ? await this.masters.customerIdByCode(c) : null)
  }

  resolveVendor(code: unknown): Promise<string | null> {
    const c = str(code)
    return c ? this.masters.vendorIdByCode(c) : Promise.resolve(null)
  }

  async resolveForwarderLink(name: unknown, aliases: CuratedAliasMaps = emptyAliasMaps()): Promise<ForwarderLink> {
    const n = str(name)
    if (!n) return { id: null, tier: null }
    // Curated exact alias: raw name → master code, then existing code path
    const aliased = aliases.forwarderAlias.get(n.toUpperCase())
    const lookup = aliased ?? n
    const byCode = await this.masters.forwarderIdByCode(lookup)
    if (byCode) return { id: byCode, tier: 'code_exact' }
    if (aliased) return { id: null, tier: null } // alias pointed at missing code — leave unlinked
    const link = await this.masters.forwarderLinkByName(n)
    return link ?? { id: null, tier: null }
  }

  async resolvePortLink(code: unknown, aliases: CuratedAliasMaps = emptyAliasMaps()): Promise<PortLink | null> {
    const c = str(code)
    if (!c) return null
    // Curated exact alias: raw → UN/LOCODE (also covered by portLinkByCodeOrName facts; pre-map is explicit for batch load)
    const aliased = aliases.portAlias.get(c.toUpperCase())
    return this.masters.portLinkByCodeOrName(aliased ?? c)
  }

  /** Parallel resolve of the five party/route links the committer needs for a group. */
  async resolveAll(
    fields: Record<string, unknown>,
    aliases: CuratedAliasMaps = emptyAliasMaps(),
  ): Promise<{
    customerId: string | null
    vendorId: string | null
    forwarderLink: ForwarderLink
    polLink: PortLink | null
    podLink: PortLink | null
  }> {
    const [customerId, vendorId, forwarderLink, polLink, podLink] = await Promise.all([
      this.resolveCustomer(fields.customer_code),
      this.resolveVendor(fields.vendor_code),
      this.resolveForwarderLink(fields.forwarder_name, aliases),
      this.resolvePortLink(fields.poi ?? fields.pol, aliases),
      this.resolvePortLink(fields.pod, aliases),
    ])
    return { customerId, vendorId, forwarderLink, polLink, podLink }
  }
}
