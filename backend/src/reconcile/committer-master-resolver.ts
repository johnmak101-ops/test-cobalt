/**
 * MasterResolver — stateful collaborator extracted from CommitterService.
 * Resolves customer / vendor / forwarder / port codes→ids (and forwarder/port link tiers for shadow metering).
 * All I/O goes through MastersRepository; no shipment/booking writes.
 */
import { MastersRepository, type ForwarderLinkTier, type PortLinkTier } from '../db/repositories/masters.repository'
import { str } from './match-keys'

export type ForwarderLink = { id: string | null; tier: ForwarderLinkTier | null }
export type PortLink = { id: string; country: string | null; tier: PortLinkTier }

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

  async resolveForwarderLink(name: unknown): Promise<ForwarderLink> {
    const n = str(name)
    if (!n) return { id: null, tier: null }
    const byCode = await this.masters.forwarderIdByCode(n)
    if (byCode) return { id: byCode, tier: 'code_exact' }
    const link = await this.masters.forwarderLinkByName(n)
    return link ?? { id: null, tier: null }
  }

  async resolvePortLink(code: unknown): Promise<PortLink | null> {
    const c = str(code)
    return c ? this.masters.portLinkByCodeOrName(c) : null
  }

  /** Parallel resolve of the five party/route links the committer needs for a group. */
  async resolveAll(fields: Record<string, unknown>): Promise<{
    customerId: string | null
    vendorId: string | null
    forwarderLink: ForwarderLink
    polLink: PortLink | null
    podLink: PortLink | null
  }> {
    const [customerId, vendorId, forwarderLink, polLink, podLink] = await Promise.all([
      this.resolveCustomer(fields.customer_code),
      this.resolveVendor(fields.vendor_code),
      this.resolveForwarderLink(fields.forwarder_name),
      this.resolvePortLink(fields.poi ?? fields.pol), // POL: id + country; alias: parser still emits `pol`
      this.resolvePortLink(fields.pod),
    ])
    return { customerId, vendorId, forwarderLink, polLink, podLink }
  }
}
