import { Inject, Injectable } from '@nestjs/common'
import { and, eq, ilike, desc, sql } from 'drizzle-orm'
import * as schema from '@cobalt/contracts'
import { DRIZZLE, type DrizzleDB } from '../drizzle.provider'

type ResolutionKind = (typeof schema.MASTER_RESOLUTION_KIND)[number]

/** Data access for master data (read + tiered resolution). */
@Injectable()
export class MastersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listCustomers() {
    return this.db.select().from(schema.customers).orderBy(schema.customers.name)
  }
  listVendors() {
    return this.db.select().from(schema.vendors).orderBy(schema.vendors.name)
  }
  listForwarders() {
    return this.db.select().from(schema.forwarders).orderBy(schema.forwarders.name)
  }
  listPorts() {
    return this.db.select().from(schema.ports).orderBy(schema.ports.unlocode)
  }
  listConsignees() {
    return this.db.select().from(schema.consignees).orderBy(schema.consignees.name)
  }

  async customerIdByCode(code: string) {
    const [r] = await this.db.select().from(schema.customers).where(eq(schema.customers.code, code.toUpperCase()))
    return r?.id ?? null
  }
  async customerByCode(code: string) {
    const [r] = await this.db.select().from(schema.customers).where(eq(schema.customers.code, code.toUpperCase()))
    return r ? { id: r.id, code: r.code, name: r.name } : null
  }
  /** Fold an alias/duplicate code to its approved canonical (COLEB→COLE). Returns the input (uppercased)
   *  when no approved customer_canonical fact exists. */
  async canonicalCode(code: string): Promise<string> {
    const c = code.toUpperCase()
    const [r] = await this.db
      .select()
      .from(schema.masterResolution)
      .where(and(eq(schema.masterResolution.kind, 'customer_canonical'), eq(schema.masterResolution.lhs, c), eq(schema.masterResolution.status, 'approved')))
    return r?.rhs?.toUpperCase() ?? c
  }
  /** The approved buyer-group id for a code, or null. A BLANK group id is treated as NO fact (fail-safe:
   *  an empty key must never read as "same group" against another empty one). */
  async customerGroupOf(code: string): Promise<string | null> {
    const [r] = await this.db
      .select()
      .from(schema.masterResolution)
      .where(and(eq(schema.masterResolution.kind, 'customer_group'), eq(schema.masterResolution.lhs, code.toUpperCase()), eq(schema.masterResolution.status, 'approved')))
    const g = r?.rhs?.trim()
    return g ? g.toUpperCase() : null
  }
  async vendorIdByCode(code: string) {
    const [r] = await this.db.select().from(schema.vendors).where(eq(schema.vendors.code, code.toUpperCase()))
    return r?.id ?? null
  }
  /** Existence checks for link-validation (PO writes never CREATE masters — resolve-or-reject). */
  async customerExists(id: string) {
    const [r] = await this.db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.id, id))
    return !!r
  }
  async vendorExists(id: string) {
    const [r] = await this.db.select({ id: schema.vendors.id }).from(schema.vendors).where(eq(schema.vendors.id, id))
    return !!r
  }
  async forwarderById(id: string) {
    const [r] = await this.db.select().from(schema.forwarders).where(eq(schema.forwarders.id, id))
    return r ?? null
  }
  async forwarderIdByName(name: string) {
    const [r] = await this.db.select().from(schema.forwarders).where(ilike(schema.forwarders.name, `%${name}%`))
    if (r) return r.id
    const [a] = await this.db.select().from(schema.forwarderAliases).where(ilike(schema.forwarderAliases.value, `%${name}%`))
    return a?.forwarderId ?? null
  }
  async portIdByCodeOrName(code: string) {
    return (await this.portByCodeOrName(code))?.id ?? null
  }
  /** Resolve a POL/POD string to a port (id + country, for denormalizing origin_country at commit).
   *  Exact UN/LOCODE first; then a BIDIRECTIONAL name match (the port name appears in the free-text,
   *  e.g. "QINGDAO, CHINA" → Qingdao, OR the input appears in the name) guarded by name length ≥ 4. */
  async portByCodeOrName(code: string): Promise<{ id: string; country: string | null } | null> {
    const c = code.trim()
    if (!c) return null
    const [byCode] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, c.toUpperCase()))
    if (byCode) return { id: byCode.id, country: byCode.country }
    const [byName] = await this.db
      .select()
      .from(schema.ports)
      .where(
        sql`length(${schema.ports.name}) >= 4 AND (${schema.ports.name} ILIKE ${`%${c}%`} OR ${c} ILIKE '%' || ${schema.ports.name} || '%')`,
      )
      .limit(1)
    return byName ? { id: byName.id, country: byName.country } : null
  }

  // --- writes (Ops-maintained masters: forwarders / ports / consignees) ---
  async createForwarder(v: { code: string | null; name: string }) {
    const [r] = await this.db.insert(schema.forwarders).values(v).returning()
    return r
  }
  async updateForwarder(id: string, patch: Record<string, unknown>) {
    const [r] = await this.db
      .update(schema.forwarders)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.forwarders.id, id))
      .returning()
    return r ?? null
  }

  async createPort(v: { unlocode: string; name: string; country: string | null; mode: string }) {
    const [r] = await this.db
      .insert(schema.ports)
      .values({ unlocode: v.unlocode, name: v.name, country: v.country, mode: v.mode as 'sea' | 'air' })
      .returning()
    return r
  }
  async updatePort(id: string, patch: Record<string, unknown>) {
    // ports has no updatedAt column
    const [r] = await this.db.update(schema.ports).set(patch).where(eq(schema.ports.id, id)).returning()
    return r ?? null
  }

  async createConsignee(v: { name: string; address: string | null; mapsToCustomerId: string | null }) {
    const [r] = await this.db.insert(schema.consignees).values(v).returning()
    return r
  }
  async updateConsignee(id: string, patch: Record<string, unknown>) {
    const [r] = await this.db
      .update(schema.consignees)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.consignees.id, id))
      .returning()
    return r ?? null
  }

  // --- master resolution (curated facts + proposals) ---
  listResolution(status: (typeof schema.MASTER_RESOLUTION_STATUS)[number]) {
    return this.db
      .select()
      .from(schema.masterResolution)
      .where(eq(schema.masterResolution.status, status))
      .orderBy(desc(schema.masterResolution.createdAt))
  }

  /** Insert a proposal; the (kind,lhs,rhs) unique constraint dedups, so a repeat returns null. */
  async createProposal(v: {
    kind: ResolutionKind
    lhs: string
    rhs: string | null
    reason: string | null
    evidence: unknown
  }) {
    const [r] = await this.db
      .insert(schema.masterResolution)
      .values({ kind: v.kind, lhs: v.lhs, rhs: v.rhs, reason: v.reason, evidence: v.evidence, source: 'curator', status: 'proposed' })
      .onConflictDoNothing()
      .returning()
    return r ?? null
  }

  async setProposalStatus(id: string, status: 'approved' | 'rejected', reviewerId: string) {
    const [r] = await this.db
      .update(schema.masterResolution)
      .set({ status, reviewedBy: reviewerId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.masterResolution.id, id))
      .returning()
    return r ?? null
  }

  /** Already-approved (kind:lhs) keys — so the curator doesn't re-propose a settled fact. */
  async approvedKeys(): Promise<Set<string>> {
    const rows = await this.db
      .select({ kind: schema.masterResolution.kind, lhs: schema.masterResolution.lhs })
      .from(schema.masterResolution)
      .where(eq(schema.masterResolution.status, 'approved'))
    return new Set(rows.map((r) => `${r.kind}:${r.lhs.toUpperCase()}`))
  }

  /** Curator signal: per customer_code, how often each consignee / vendor co-occurs in the evidence. */
  async evidenceMajorities() {
    const res = await this.db.execute(sql`
      SELECT fields->>'customer_code' AS cust,
             fields->>'consignee_name' AS consignee,
             fields->>'vendor_code'    AS vendor,
             count(*)::int             AS n
      FROM evidence.parsed_record
      WHERE fields->>'customer_code' IS NOT NULL
      GROUP BY 1, 2, 3`)
    return (res as unknown as { rows: { cust: string; consignee: string | null; vendor: string | null; n: number }[] }).rows
  }
}
