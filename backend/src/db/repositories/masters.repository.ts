import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/**
 * Run multi-row inserts in sequential chunks so each statement stays under SQL Server /
 * tedious' 2100-parameter hard cap (same class of fix as ports-sync MERGE_BATCH=400).
 * No-ops on empty input (matches prior `if (rows.length)` guards).
 */
export async function insertInBatches<T>(
  rows: readonly T[],
  batchSize: number,
  insertChunk: (chunk: T[]) => Promise<void>,
): Promise<void> {
  if (!rows.length) return
  if (batchSize < 1) throw new Error(`insertInBatches: batchSize must be >= 1, got ${batchSize}`)
  for (let i = 0; i < rows.length; i += batchSize) {
    await insertChunk(rows.slice(i, i + batchSize) as T[])
  }
}

/** Exact-only tiers. Fuzzy/containment removed 2026-07-12 — queue LLM Master Matcher owns free-text. */
export type ForwarderLinkTier = 'code_exact' | 'norm_exact' | 'stripped_norm_exact'

/** @deprecated empty — fuzzy tiers deleted; kept for any external import that still names the set */
export const FUZZY_FORWARDER_TIERS: ReadonlySet<ForwarderLinkTier> = new Set()

export type PortLinkTier = 'unlocode_exact' | 'abbreviation' | 'iata' | 'alias' | 'fragment'

/**
 * Kysely/SQL Server MastersRepository.
 *
 * Free-text fuzzy (LIKE / reverse-containment) DELETED 2026-07-12 — queue LLM Master Matcher owns it.
 * Track keeps only exact/code + curated master_resolution facts (incl. port_fragment keyed facts).
 * Unresolved free text → null + committer review flag.
 */
@Injectable()
export class MastersRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

  listCustomers() {
    return this.db.selectFrom('customers').orderBy('name').selectAll().execute()
  }
  listVendors() {
    return this.db.selectFrom('vendors').orderBy('name').selectAll().execute()
  }
  listForwarders() {
    return this.db.selectFrom('forwarders').orderBy('name').selectAll().execute()
  }
  listPorts() {
    return this.db.selectFrom('ports').orderBy('unlocode').selectAll().execute()
  }

  /** Detail-page path: only the ports we need (pol/pod), not the full ~24k-row catalogue. */
  async portsByIds(ids: string[]) {
    const uniq = [...new Set(ids.filter(Boolean))]
    if (!uniq.length) return [] as Awaited<ReturnType<MastersRepository['listPorts']>>
    return this.db.selectFrom('ports').where('id', 'in', uniq).selectAll().execute()
  }
  listConsignees() {
    return this.db.selectFrom('consignees').orderBy('name').selectAll().execute()
  }

  // ---- masters sync (ERP mirror; insert new + fill-if-changed; NEVER deletes) ----
  // SQL Server / tedious hard-cap 2100 parameters per statement (same issue ports-sync solves with MERGE_BATCH).
  // Customers: 6 bound cols → 300×6=1800; vendors: 7 → 250×7=1750; forwarders: 2 → 500×2=1000.
  // id / created_at / updated_at are server defaults (NEWID / SYSDATETIMEOFFSET), not client params.
  static readonly CUSTOMER_INSERT_BATCH = 300
  static readonly VENDOR_INSERT_BATCH = 250
  static readonly FORWARDER_INSERT_BATCH = 500

  async insertCustomers(rows: { code: string; name: string; country: string | null; contactEmail: string | null; address: string | null; erpSyncedAt: Date }[]) {
    await insertInBatches(rows, MastersRepository.CUSTOMER_INSERT_BATCH, (chunk) =>
      this.db.insertInto('customers').values(chunk).execute().then(() => undefined),
    )
  }
  async updateCustomer(id: string, patch: { name?: string; country?: string | null; contactEmail?: string | null; address?: string | null; erpSyncedAt: Date }) {
    await this.db.updateTable('customers').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).execute()
  }
  async insertVendors(rows: { code: string; name: string; type: 'factory' | 'agent'; location: string | null; contactEmail: string | null; contactPhone: string | null; erpSyncedAt: Date }[]) {
    await insertInBatches(rows, MastersRepository.VENDOR_INSERT_BATCH, (chunk) =>
      this.db.insertInto('vendors').values(chunk).execute().then(() => undefined),
    )
  }
  async updateVendor(id: string, patch: { name?: string; type?: 'factory' | 'agent'; location?: string | null; contactEmail?: string | null; contactPhone?: string | null; erpSyncedAt: Date }) {
    await this.db.updateTable('vendors').set({ ...patch, updatedAt: new Date() }).where('id', '=', id).execute()
  }
  async insertForwarders(rows: { code: string; name: string }[]) {
    await insertInBatches(rows, MastersRepository.FORWARDER_INSERT_BATCH, (chunk) =>
      this.db.insertInto('forwarders').values(chunk).execute().then(() => undefined),
    )
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
  /** All forwarder aliases (name / domain / chinese_name rows) — retrieval signals for the candidates endpoint. */
  listForwarderAliases() {
    return this.db.selectFrom('forwarderAliases').select(['forwarderId', 'aliasType', 'value']).execute()
  }

  // ---- co-occurrence signals for the candidates endpoint (matcher Phase 2) ----

  /** Customer codes owning any of the given PO numbers — a PO in the request context pins its buyer. */
  async customerCodesByPoNumbers(poNumbers: string[]): Promise<Set<string>> {
    if (!poNumbers.length) return new Set()
    const rows = await this.db
      .selectFrom('purchaseOrders')
      .innerJoin('customers', 'purchaseOrders.customerId', 'customers.id')
      .where('purchaseOrders.poNumber', 'in', poNumbers)
      .select('customers.code as code')
      .execute()
    return new Set(rows.map((r) => r.code.toUpperCase()))
  }

  /** Vendor + forwarder codes historically co-occurring with a customer (via its bookings and their
   *  shipments) — history makes a candidate more plausible, never decisive (a boost, not a filter). */
  async cooccurringPartyCodes(customerCode: string): Promise<{ vendors: Set<string>; forwarders: Set<string> }> {
    const vendors = new Set<string>()
    const forwarders = new Set<string>()
    const code = customerCode.toUpperCase()
    const v = await this.db
      .selectFrom('bookings')
      .innerJoin('customers', 'bookings.customerId', 'customers.id')
      .innerJoin('vendors', 'bookings.vendorId', 'vendors.id')
      .where('customers.code', '=', code)
      .select('vendors.code as code')
      .distinct()
      .execute()
    for (const r of v) if (r.code) vendors.add(r.code.toUpperCase())
    const fb = await this.db
      .selectFrom('bookings')
      .innerJoin('customers', 'bookings.customerId', 'customers.id')
      .innerJoin('forwarders', 'bookings.forwarderId', 'forwarders.id')
      .where('customers.code', '=', code)
      .select('forwarders.code as code')
      .distinct()
      .execute()
    const fs = await this.db
      .selectFrom('shipments')
      .innerJoin('bookings', 'shipments.bookingId', 'bookings.id')
      .innerJoin('customers', 'bookings.customerId', 'customers.id')
      .innerJoin('forwarders', 'shipments.forwarderId', 'forwarders.id')
      .where('customers.code', '=', code)
      .select('forwarders.code as code')
      .distinct()
      .execute()
    for (const r of [...fb, ...fs]) if (r.code) forwarders.add(r.code.toUpperCase())
    return { vendors, forwarders }
  }

  /** Customer codes whose POs/bookings carry the given brand — brand names travel with the buyer. */
  async customerCodesByBrand(brand: string): Promise<Set<string>> {
    const b = brand.trim()
    if (!b) return new Set()
    const po = await this.db
      .selectFrom('purchaseOrders')
      .innerJoin('customers', 'purchaseOrders.customerId', 'customers.id')
      .where(sql<boolean>`LOWER(${sql.ref('purchase_orders.brand')}) = ${b.toLowerCase()}`)
      .select('customers.code as code')
      .distinct()
      .execute()
    const bk = await this.db
      .selectFrom('bookings')
      .innerJoin('customers', 'bookings.customerId', 'customers.id')
      .where(sql<boolean>`LOWER(${sql.ref('bookings.brand')}) = ${b.toLowerCase()}`)
      .select('customers.code as code')
      .distinct()
      .execute()
    return new Set([...po, ...bk].map((r) => r.code.toUpperCase()))
  }

  /** Exact, case-insensitive forwarder CODE lookup — exactly-one-guarded like every name tier (a duplicate
   *  code must not resolve heap-order style). The fast path for LLM-matcher write-backs. */
  async forwarderIdByCode(code: string): Promise<string | null> {
    const c = code.trim().toUpperCase()
    if (!c) return null
    const hits = await this.db
      .selectFrom('forwarders')
      .select(['id', 'code'])
      .execute()
    const match = hits.filter((f) => (f.code ?? '').trim().toUpperCase() === c)
    return match.length === 1 ? match[0]!.id : null
  }

  /** Strict UN/LOCODE-only port lookup (no tiers) — used by the prior_correction validator. */
  async portIdByUnlocode(code: string): Promise<string | null> {
    const c = code.trim().toUpperCase()
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(c)) return null
    const r = await this.db.selectFrom('ports').select('id').where('unlocode', '=', c).executeTakeFirst()
    return r?.id ?? null
  }

  /**
   * Exact-only forwarder name link (fuzzy deleted 2026-07-12).
   *   · normalized exact match on master name or alias (punctuation-insensitive, exactly-one)
   *   · same after stripping office/email parentheticals
   * Free-text that needs judgment → queue LLM Master Matcher; track leaves null + review.
   */
  async forwarderLinkByName(name: string): Promise<{ id: string; tier: ForwarderLinkTier } | null> {
    const all = await this.db.selectFrom('forwarders').select(['id', 'name']).execute()
    const aliases = await this.db.selectFrom('forwarderAliases').select(['forwarderId', 'value']).execute()
    const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const byNorm = (key: string): string | null => {
      if (key.length < 4) return null
      const n = all.filter((f) => normalize(f.name) === key)
      if (n.length === 1) return n[0]!.id
      const na = aliases.filter((a) => normalize(a.value) === key)
      if (na.length === 1) return na[0]!.forwarderId
      return null
    }
    const norm = normalize(name)
    const normHit = byNorm(norm)
    if (normHit) return { id: normHit, tier: 'norm_exact' }
    const stripped = name
      .replace(/\([^)]*\)/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const strippedNorm = normalize(stripped)
    if (strippedNorm !== norm) {
      const hit = byNorm(strippedNorm)
      if (hit) return { id: hit, tier: 'stripped_norm_exact' }
    }
    return null
  }

  async forwarderIdByName(name: string): Promise<string | null> {
    return (await this.forwarderLinkByName(name))?.id ?? null
  }

  async portIdByCodeOrName(code: string) {
    return (await this.portByCodeOrName(code))?.id ?? null
  }
  /**
   * Exact + curated facts only (open LIKE fuzzy_name deleted 2026-07-12).
   * Order: UN/LOCODE → abbreviation fact → ports.iata → port_alias/port_iata facts → port_fragment facts.
   */
  async portLinkByCodeOrName(code: string): Promise<{ id: string; country: string | null; tier: PortLinkTier } | null> {
    const c = code.trim()
    if (!c) return null
    const byUnlocode = async (uloc: string) => {
      const a = await this.db.selectFrom('ports').select(['id', 'country']).where('unlocode', '=', uloc).executeTakeFirst()
      return a ? { id: a.id, country: a.country } : null
    }
    const byCode = await byUnlocode(c.toUpperCase())
    if (byCode) return { ...byCode, tier: 'unlocode_exact' }

    const portFacts = await this.db
      .selectFrom('masterResolution')
      .where('kind', 'in', ['port_abbreviation', 'port_alias', 'port_iata', 'port_fragment'])
      .where('status', '=', 'approved')
      .where('active', '=', true)
      .select(['kind', 'lhs', 'rhs'])
      .execute()
    const factMap = (kind: string) =>
      new Map(portFacts.filter((f) => f.kind === kind && f.rhs).map((f) => [f.lhs.toUpperCase(), String(f.rhs).toUpperCase()]))

    const abbrev = factMap('port_abbreviation').get(c.toUpperCase())
    if (abbrev) {
      const a = await byUnlocode(abbrev)
      if (a) return { ...a, tier: 'abbreviation' }
    }
    if (/^[A-Za-z]{3}$/.test(c)) {
      const byIata = await this.db
        .selectFrom('ports')
        .select(['id', 'country'])
        .where('iata', '=', c.toUpperCase())
        .orderBy(sql`len(${sql.ref('name')})`)
        .modifyFront(sql`top 1`)
        .executeTakeFirst()
      if (byIata) return { id: byIata.id, country: byIata.country, tier: 'iata' }
    }

    const aliasKey = c.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const alias = factMap('port_alias').get(aliasKey)
    if (alias) {
      const a = await byUnlocode(alias)
      if (a) return { ...a, tier: 'alias' }
    }
    const iata = factMap('port_iata').get(aliasKey)
    if (iata) {
      const a = await byUnlocode(iata)
      if (a) return { ...a, tier: 'iata' }
    }
    // Curated fragments only (ADMIN data) — not open fuzzy LIKE against ports.name
    for (const [frag, uloc] of factMap('port_fragment')) {
      if (aliasKey.includes(frag)) {
        const a = await byUnlocode(uloc)
        if (a) return { ...a, tier: 'fragment' }
      }
    }
    return null
  }

  /** Thin wrapper over `portLinkByCodeOrName` for callers that only need id + country (no tier). */
  async portByCodeOrName(code: string): Promise<{ id: string; country: string | null } | null> {
    const l = await this.portLinkByCodeOrName(code)
    return l ? { id: l.id, country: l.country } : null
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

  // --- carriers (ocean carriers keyed by SCAC — seeded + ops-maintained, no ERP home; the data home
  //     for SCAC extraction/validation) ---
  listCarriers() {
    return this.db.selectFrom('carriers').orderBy('scac').selectAll().execute()
  }
  async carrierByScac(scac: string) {
    const r = await this.db.selectFrom('carriers').selectAll().where('scac', '=', scac.trim().toUpperCase()).executeTakeFirst()
    return r ?? null
  }
  createCarrier(v: { scac: string; name: string }) {
    return this.db
      .insertInto('carriers')
      .values({ scac: v.scac.trim().toUpperCase(), name: v.name.trim() })
      .outputAll('inserted')
      .executeTakeFirstOrThrow()
  }
  async updateCarrier(id: string, patch: { scac?: string; name?: string }) {
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (patch.scac !== undefined) set.scac = patch.scac.trim().toUpperCase()
    if (patch.name !== undefined) set.name = patch.name.trim()
    const r = await this.db.updateTable('carriers').set(set).where('id', '=', id).outputAll('inserted').executeTakeFirst()
    return r ?? null
  }

  // --- master resolution (curated facts + proposals) ---
  listResolution(status: 'approved' | 'proposed' | 'rejected') {
    return this.db.selectFrom('masterResolution').where('status', '=', status).where('active', '=', true).orderBy('createdAt', 'desc').selectAll().execute()
  }
  listResolutionManage() {
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

  /**
   * Distinct unresolved forwarder/port raw values on non-dismissed SHIPMENT legs, with counts.
   * Sources: forwarder_raw (no forwarder_id), pol_raw (no pol_id), pod_raw (no pod_id).
   */
  async unmatchedRawValues(): Promise<Array<{ field: string; value: string; legsAffected: number }>> {
    const res = await sql<{ field: string; value: string; legsAffected: number }>`
      SELECT field, value, COUNT(*) AS legsAffected FROM (
        SELECT 'forwarder' AS field, LTRIM(RTRIM(forwarder_raw)) AS value
        FROM shipments
        WHERE kind = 'SHIPMENT'
          AND dismissed_at IS NULL
          AND forwarder_id IS NULL
          AND forwarder_raw IS NOT NULL
          AND LTRIM(RTRIM(forwarder_raw)) <> ''
        UNION ALL
        SELECT 'pol' AS field, LTRIM(RTRIM(pol_raw)) AS value
        FROM shipments
        WHERE kind = 'SHIPMENT'
          AND dismissed_at IS NULL
          AND pol_id IS NULL
          AND pol_raw IS NOT NULL
          AND LTRIM(RTRIM(pol_raw)) <> ''
        UNION ALL
        SELECT 'pod' AS field, LTRIM(RTRIM(pod_raw)) AS value
        FROM shipments
        WHERE kind = 'SHIPMENT'
          AND dismissed_at IS NULL
          AND pod_id IS NULL
          AND pod_raw IS NOT NULL
          AND LTRIM(RTRIM(pod_raw)) <> ''
      ) u
      GROUP BY field, value
      ORDER BY COUNT(*) DESC, field, value`.execute(this.db)
    return res.rows.map((r) => ({
      field: r.field,
      value: r.value,
      legsAffected: Number(r.legsAffected),
    }))
  }
}
