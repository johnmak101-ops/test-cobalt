import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db.generated'

/**
 * Kysely/SQL Server port of MastersRepository (decision B: data-access ported faithfully; the heavy
 * deterministic resolution tiers — fuzzy name matching, curated alias tables, legal-form fold — are
 * NOT ported. They resolve by EXACT name/alias/code only, returning null otherwise. Those tiers are
 * slated for deletion by the LLM Master Matcher; the Postgres Drizzle path keeps the full logic until
 * the matcher lands post-migration.)
 *
 * Method signatures match MastersRepository so the NestJS providers can swap in this implementation.
 */
export class KyselyMastersRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async listCustomers() {
    return this.db.selectFrom('customers').orderBy('name').selectAll().execute()
  }
  async listVendors() {
    return this.db.selectFrom('vendors').orderBy('name').selectAll().execute()
  }
  async listForwarders() {
    return this.db.selectFrom('forwarders').orderBy('name').selectAll().execute()
  }
  async listPorts() {
    return this.db.selectFrom('ports').orderBy('unlocode').selectAll().execute()
  }
  async listConsignees() {
    return this.db.selectFrom('consignees').orderBy('name').selectAll().execute()
  }

  // ---- masters sync (ERP mirror; insert new + fill-if-changed; NEVER deletes) ----
  async insertCustomers(rows: { code: string; name: string; country: string | null; contactEmail: string | null; address: string | null; erpSyncedAt: Date }[]) {
    if (rows.length) await this.db.insertInto('customers').values(rows).execute()
  }
  async updateCustomer(id: string, patch: { name?: string; country?: string | null; contactEmail?: string | null; address?: string | null; erpSyncedAt: Date }) {
    await this.db.updateTable('customers').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).execute()
  }
  async insertVendors(rows: { code: string; name: string; type: 'factory' | 'agent'; location: string | null; contactEmail: string | null; contactPhone: string | null; erpSyncedAt: Date }[]) {
    if (rows.length) await this.db.insertInto('vendors').values(rows).execute()
  }
  async updateVendor(id: string, patch: { name?: string; type?: 'factory' | 'agent'; location?: string | null; contactEmail?: string | null; contactPhone?: string | null; erpSyncedAt: Date }) {
    await this.db.updateTable('vendors').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).execute()
  }
  async insertForwarders(rows: { code: string; name: string }[]) {
    if (rows.length) await this.db.insertInto('forwarders').values(rows).execute()
  }
  async updateForwarder(id: string, patch: Record<string, unknown>) {
    await this.db.updateTable('forwarders').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).execute()
  }

  async customerIdByCode(code: string) {
    const r = await this.db.selectFrom('customers').select('id').where('code', '=', code.toUpperCase()).executeTakeFirst()
    return r?.id ?? null
  }
  async customerByCode(code: string) {
    const r = await this.db.selectFrom('customers').select(['id', 'code', 'name']).where('code', '=', code.toUpperCase()).executeTakeFirst()
    return r ? { id: r.id, code: r.code, name: r.name } : null
  }
  async canonicalCode(code: string): Promise<string> {
    const c = code.toUpperCase()
    const r = await this.db
      .selectFrom('masterResolution')
      .where('kind', '=', 'customer_canonical')
      .where('lhs', '=', c)
      .where('status', '=', 'approved')
      .where('active', '=', true)
      .select('rhs')
      .executeTakeFirst()
    return r?.rhs?.toUpperCase() ?? c
  }
  async customerGroupOf(code: string): Promise<string | null> {
    const r = await this.db
      .selectFrom('masterResolution')
      .where('kind', '=', 'customer_group')
      .where('lhs', '=', code.toUpperCase())
      .where('status', '=', 'approved')
      .where('active', '=', true)
      .select('rhs')
      .executeTakeFirst()
    const g = r?.rhs?.trim()
    return g ? g.toUpperCase() : null
  }
  async vendorIdByCode(code: string) {
    const r = await this.db.selectFrom('vendors').select('id').where('code', '=', code.toUpperCase()).executeTakeFirst()
    return r?.id ?? null
  }
  async customerExists(id: string) {
    const r = await this.db.selectFrom('customers').select('id').where('id', '=', id).executeTakeFirst()
    return !!r
  }
  async vendorExists(id: string) {
    const r = await this.db.selectFrom('vendors').select('id').where('id', '=', id).executeTakeFirst()
    return !!r
  }
  async forwarderById(id: string) {
    const r = await this.db.selectFrom('forwarders').selectAll().where('id', '=', id).executeTakeFirst()
    return r ?? null
  }

  /**
   * EXACT-MATCH-ONLY port (decision B). Resolves a forwarder by:
   *   1. exact master name (case-insensitive)  2. exact alias value (case-insensitive)
   * The Postgres fuzzy tiers (containment, normalized-exact, org-token, reverse-containment, legal-form
   * fold) are NOT ported — they're slated for the LLM Master Matcher. Returns null on no exact match.
   */
  async forwarderIdByName(name: string): Promise<string | null> {
    const byName = await this.db.selectFrom('forwarders').select('id').where(sql`LOWER(${sql.ref('name')})`, '=', name.toLowerCase()).executeTakeFirst()
    if (byName) return byName.id
    const byAlias = await this.db.selectFrom('forwarderAliases').select('forwarderId').where(sql`LOWER(${sql.ref('value')})`, '=', name.toLowerCase()).executeTakeFirst()
    return byAlias?.forwarderId ?? null
  }

  async portIdByCodeOrName(code: string) {
    return (await this.portByCodeOrName(code))?.id ?? null
  }
  /**
   * EXACT-MATCH-ONLY port (decision B). Resolves by exact UN/LOCODE, exact IATA (bare 3-char), then
   * exact name. The curated alias tables (PORT_ALIASES, IATA_TO_UNLOCODE, NAME_CONTAINS_ALIASES) and
   * the fuzzy name match are NOT ported — slated for the LLM Master Matcher.
   */
  async portByCodeOrName(code: string): Promise<{ id: string; country: string | null } | null> {
    const c = code.trim()
    if (!c) return null
    const byCode = await this.db.selectFrom('ports').select(['id', 'country']).where('unlocode', '=', c.toUpperCase()).executeTakeFirst()
    if (byCode) return { id: byCode.id, country: byCode.country }
    if (/^[A-Za-z]{3}$/.test(c)) {
      const byIata = await this.db.selectFrom('ports').select(['id', 'country']).where('iata', '=', c.toUpperCase()).executeTakeFirst()
      if (byIata) return { id: byIata.id, country: byIata.country }
    }
    const byName = await this.db.selectFrom('ports').select(['id', 'country']).where(sql`LOWER(${sql.ref('name')})`, '=', c.toLowerCase()).executeTakeFirst()
    return byName ? { id: byName.id, country: byName.country } : null
  }

  // --- ops writes (forwarders / ports / consignees) ---
  async createForwarder(v: { code: string | null; name: string }) {
    const r = await this.db.insertInto('forwarders').values(v).outputAll('inserted').executeTakeFirstOrThrow()
    return r
  }
  async createPort(v: { unlocode: string; name: string; country: string | null; mode: string }) {
    const r = await this.db.insertInto('ports').values({ unlocode: v.unlocode, name: v.name, country: v.country, mode: v.mode as 'sea' | 'air' | 'both' }).outputAll('inserted').executeTakeFirstOrThrow()
    return r
  }
  async createConsignee(v: { name: string; address: string | null; mapsToCustomerId: string | null }) {
    const r = await this.db.insertInto('consignees').values(v).outputAll('inserted').executeTakeFirstOrThrow()
    return r
  }
  async updatePort(id: string, patch: Record<string, unknown>) {
    const r = await this.db.updateTable('ports').set(patch).where('id', '=', id).executeTakeFirst()
    return r ?? null
  }
  async updateConsignee(id: string, patch: Record<string, unknown>) {
    const r = await this.db.updateTable('consignees').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).executeTakeFirst()
    return r ?? null
  }

  // --- master resolution (curated facts + proposals) ---
  async listResolution(status: 'approved' | 'proposed' | 'rejected') {
    return this.db.selectFrom('masterResolution').where('status', '=', status).where('active', '=', true).orderBy('createdAt desc').selectAll().execute()
  }
  async listResolutionManage() {
    return this.db.selectFrom('masterResolution').where('status', '=', 'approved').orderBy('kind').orderBy('lhs').selectAll().execute()
  }
  async getFact(id: string) {
    const r = await this.db.selectFrom('masterResolution').selectAll().where('id', '=', id).executeTakeFirst()
    return r ?? null
  }
  async deactivateActiveFor(kind: string, lhs: string) {
    await this.db.updateTable('masterResolution').set({ active: false, updatedAt: new Date() }).where('kind', '=', kind).where('lhs', '=', lhs).where('active', '=', true).execute()
  }
  async insertOpsFact(v: { kind: string; lhs: string; rhs: string | null; reason: string | null; createdBy: string | null }) {
    // MERGE (upsert) on (kind, lhs, rhs): reactivate an exact existing row, else insert.
    const existing = await this.db.selectFrom('masterResolution').selectAll().where('kind', '=', v.kind).where('lhs', '=', v.lhs).where((eb) => eb.or([eb('rhs', '=', v.rhs), eb.and([eb('rhs', 'is', null), eb('rhs', 'is', null)])])).executeTakeFirst()
    if (existing) {
      const r = await this.db.updateTable('masterResolution').set({ active: true, status: 'approved', reason: v.reason, source: 'ops', updatedAt: new Date() }).where('id', '=', existing.id).outputAll('inserted').executeTakeFirst()
      return r ?? null
    }
    const r = await this.db.insertInto('masterResolution').values({ kind: v.kind, lhs: v.lhs, rhs: v.rhs, reason: v.reason, createdBy: v.createdBy, status: 'approved', source: 'ops', active: true }).outputAll('inserted').executeTakeFirst()
    return r ?? null
  }
  async setActive(id: string, active: boolean) {
    const r = await this.db.updateTable('masterResolution').set({ active, updatedAt: new Date() }).where('id', '=', id).outputAll('inserted').executeTakeFirst()
    return r ?? null
  }
  async patchReason(id: string, reason: string | null) {
    const r = await this.db.updateTable('masterResolution').set({ reason, updatedAt: new Date() }).where('id', '=', id).outputAll('inserted').executeTakeFirst()
    return r ?? null
  }
  async createProposal(v: { kind: string; lhs: string; rhs: string | null; reason: string | null; evidence: unknown }) {
    // dedup: if an exact (kind, lhs, rhs) row exists, return null (no re-propose)
    const existing = await this.db.selectFrom('masterResolution').select('id').where('kind', '=', v.kind).where('lhs', '=', v.lhs).where((eb) => eb.or([eb('rhs', '=', v.rhs), eb.and([eb('rhs', 'is', null), eb('rhs', 'is', null)])])).executeTakeFirst()
    if (existing) return null
    const r = await this.db.insertInto('masterResolution').values({ kind: v.kind, lhs: v.lhs, rhs: v.rhs, reason: v.reason, evidence: v.evidence === undefined ? null : JSON.stringify(v.evidence), source: 'curator', status: 'proposed' }).outputAll('inserted').executeTakeFirst()
    return r ?? null
  }
  async setProposalStatus(id: string, status: 'approved' | 'rejected', reviewerId: string) {
    const r = await this.db.updateTable('masterResolution').set({ status, reviewedBy: reviewerId, reviewedAt: new Date(), updatedAt: new Date() }).where('id', '=', id).outputAll('inserted').executeTakeFirst()
    return r ?? null
  }
  async approvedKeys(): Promise<Set<string>> {
    const rows = await this.db.selectFrom('masterResolution').select(['kind', 'lhs']).where('status', '=', 'approved').execute()
    return new Set(rows.map((r) => `${r.kind}:${r.lhs.toUpperCase()}`))
  }
  async evidenceMajorities() {
    const res = await sql<{ cust: string; consignee: string | null; vendor: string | null; n: number }>`
      SELECT JSON_VALUE(fields, '$.customer_code') AS cust,
             JSON_VALUE(fields, '$.consignee_name') AS consignee,
             JSON_VALUE(fields, '$.vendor_code')    AS vendor,
             count(*)                               AS n
      FROM parsed_record
      WHERE JSON_VALUE(fields, '$.customer_code') IS NOT NULL
      GROUP BY JSON_VALUE(fields, '$.customer_code'), JSON_VALUE(fields, '$.consignee_name'), JSON_VALUE(fields, '$.vendor_code')`.execute(this.db)
    return res.rows
  }
}
