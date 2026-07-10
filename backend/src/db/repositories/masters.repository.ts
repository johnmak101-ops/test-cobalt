import { Inject, Injectable } from '@nestjs/common'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../kysely/db'
import { KYSELY } from '../kysely.provider'

/**
 * Kysely/SQL Server MastersRepository. The full deterministic resolution tiers ARE ported — staged
 * forwarder resolution (containment / normalized-exact / org-token / reverse-containment / legal-form
 * fold, every stage exactly-one-guarded) and the tiered port resolver (ABBREV_OVERRIDE / IATA / curated
 * aliases / forward-only fuzzy) — because the LLM Master Matcher that will replace them is deferred
 * BEHIND this migration; dropping them here would silently degrade live committer resolution
 * (e.g. 'HCM' → the wrong Somali port instead of VNSGN).
 *
 * T-SQL notes: no regexp_replace on SQL Server 2022 → normalization runs in JS over the (small,
 * ERP-mirrored) master sets; ILIKE → LOWER LIKE / JS includes; limit 1 → top 1.
 */
@Injectable()
export class MastersRepository {
  constructor(@Inject(KYSELY) private readonly db: Kysely<DB>) {}

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
  /** All forwarder aliases (name / domain / chinese_name rows) — retrieval signals for the candidates endpoint. */
  async listForwarderAliases() {
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

  /**
   * Staged, ambiguity-guarded forwarder resolution (faithful port of the Drizzle tiers): containment →
   * normalized-exact (name, alias; raw + office/email-stripped) → alias containment → org-token
   * (parenthetical / email-domain, BUG 2) → reverse-containment → legal-form fold (BUG 8). Every stage
   * accepts ONLY an exactly-one match; on 0 or >1 it falls through, and an unresolved name returns null
   * so forwarder_raw surfaces.
   *
   * T-SQL note: SQL Server 2022 has no regexp_replace, so instead of pushing the normalization into SQL
   * the masters (an ERP mirror of a few hundred rows) + aliases are fetched once per call and every stage
   * runs the SAME JS normalization the Postgres SQL expressed — semantics identical, collation-proof.
   */
  async forwarderIdByName(name: string): Promise<string | null> {
    const all = await this.db.selectFrom('forwarders').select(['id', 'name']).execute()
    const aliases = await this.db.selectFrom('forwarderAliases').select(['forwarderId', 'value']).execute()
    const lower = name.toLowerCase()
    const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

    // AMBIGUITY-GUARDED first-stage containment: a substring like 'Expeditors' hits several masters
    // (EXPEDITORS - CHINA / CAMBODIA / INTERNATIONAL) — return ONLY when EXACTLY ONE master contains the
    // name; on 0 or >1 fall through (a bare ambiguous 'Expeditors' correctly leaves forwarder_raw to surface).
    const contained = all.filter((f) => f.name.toLowerCase().includes(lower))
    if (contained.length === 1) return contained[0]!.id

    // normalized exact match: strip ALL non-alphanumerics so punctuation/spacing variants resolve
    // ('LX PANTOS LOGISTICS (SHENZHEN) CO.,LTD.' == master 'LX PANTOS LOGISTICS (SHENZHEN) CO. LTD').
    // BUG 6: exactly-one guard (two masters normalizing identically must not resolve heap-order style).
    const norm = normalize(name)
    const byNorm = (key: string): string | null => {
      if (key.length < 4) return null
      const n = all.filter((f) => normalize(f.name) === key)
      if (n.length === 1) return n[0]!.id
      const na = aliases.filter((a) => normalize(a.value) === key)
      if (na.length === 1) return na[0]!.forwarderId
      return null
    }
    const normHit = byNorm(norm)
    if (normHit) return normHit

    // strip trailing office/email annotations ('Expeditors International (LAX)', 'Maersk … (lns.maersk.com)',
    // '… <ops@fwd.com>') then retry the SAME normalized-exact match — the parenthetical is not part of the name.
    const stripped = name
      .replace(/\([^)]*\)/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const strippedNorm = normalize(stripped)
    if (strippedNorm !== norm) {
      const hit = byNorm(strippedNorm)
      if (hit) return hit
    }

    // same exactly-one guard on the alias containment — an ambiguous alias substring must not arbitrarily resolve.
    const aliasContained = aliases.filter((a) => a.value.toLowerCase().includes(lower))
    if (aliasContained.length === 1) return aliasContained[0]!.forwarderId

    // BUG 2: an email-form raw like 'om-booking-notifications@expeditors.com (Expeditors)' resolves to NULL
    // above, but carries the org identity in TWO deterministic places: the parenthetical CONTENT and the
    // domain's second-level label. Run EACH token through the SAME exactly-one-guarded stages; accept only
    // when exactly one token resolves and never to two different masters.
    const orgTokens: string[] = []
    const parenContent = /\(([^)]*)\)/.exec(name)?.[1]?.trim()
    if (parenContent) orgTokens.push(parenContent)
    const emailMatch = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(name)
    if (emailMatch) {
      const labels = emailMatch[2]!.toLowerCase().split('.')
      const sld = labels.length >= 2 ? labels[labels.length - 2]! : ''
      const GENERIC_HOSTS = new Set(['gmail', 'outlook', 'hotmail', 'yahoo', 'qq', '163', '126', 'live', 'icloud', 'googlemail'])
      if (sld.length >= 3 && !GENERIC_HOSTS.has(sld)) orgTokens.push(sld)
    }
    let tokenResolved: string | null = null
    for (const tok of orgTokens) {
      const t = tok.trim()
      if (t.length < 3) continue
      // same stages as above, over the already-loaded sets (deliberately NOT recursive)
      const tc = all.filter((f) => f.name.toLowerCase().includes(t.toLowerCase()))
      const id: string | null = tc.length === 1 ? tc[0]!.id : byNorm(normalize(t))
      if (!id) continue
      if (tokenResolved && tokenResolved !== id) { tokenResolved = null; break } // two tokens disagree → ambiguous
      tokenResolved = id
    }
    if (tokenResolved) return tokenResolved

    // reverse-containment: a master whose normalized name is a SUBSTRING of the normalized input, so an
    // input with an appended office/domain ('EXPEDITORS INTERNATIONAL (LAX)') still resolves. Guarded by
    // master-name length ≥ 10 chars and LONGEST match first (prefer 'MAERSK LOGISTICS & SERVICES CHINA
    // LIMITED' over a bare 'MAERSK').
    if (norm.length >= 10) {
      const rc = all
        .filter((f) => {
          const fn = normalize(f.name)
          return fn.length >= 10 && norm.includes(fn)
        })
        .sort((a, b) => b.name.length - a.name.length)[0]
      if (rc) return rc.id
    }

    // legal-form fold: 'TradeLink Technologies Ltd' should reach master 'TRADELINK TECHNOLOGIES LIMITED'.
    // DANGER: the table holds 50+ pairs that differ ONLY by legal form as distinct coded rows — accept the
    // folded match ONLY when EXACTLY ONE forwarder folds to it (BUG 8: also try the first parenthetical's
    // CONTENT — an outer brand wrapping an inner legal name).
    const foldLegalForm = (s: string): string => {
      const tokens = s
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
      const canon: Record<string, string> = {
        LTD: 'LIMITED',
        LIMITED: 'LIMITED',
        CO: 'COMPANY',
        COMPANY: 'COMPANY',
        INC: 'INCORPORATED',
        INCORPORATED: 'INCORPORATED',
        CORP: 'CORPORATION',
        CORPORATION: 'CORPORATION',
      }
      return tokens.map((t) => canon[t] ?? t).join('')
    }
    const inner = /\(([^)]*)\)/.exec(name)?.[1]?.trim()
    for (const cand of [stripped, ...(inner ? [inner] : []), name]) {
      const inputFold = foldLegalForm(cand)
      if (inputFold.length < 4) continue
      const hits = all.filter((f) => foldLegalForm(f.name) === inputFold)
      if (hits.length === 1) return hits[0]!.id
    }
    return null
  }

  async portIdByCodeOrName(code: string) {
    return (await this.portByCodeOrName(code))?.id ?? null
  }
  /** Resolve a POL/POD string to a port (id + country, for denormalizing origin_country at commit).
   *  Order: exact UN/LOCODE → abbreviation fact → exact IATA (bare 3-char PVG/CAN) → CURATED alias
   *  facts (spelling / IATA / name-fragment, high-confidence, exact-keyed) → FORWARD fuzzy name match
   *  (last resort). Curated aliases run BEFORE the fuzzy match so a spelling variant ('Chittagong',
   *  stored as 'Chattogram') can't fall through to a loose substring hit.
   *
   *  The curated tiers are DATA, not code: `master_resolution` facts of kinds `port_abbreviation`
   *  (checked before IATA — 'HCM' must beat the obscure Somali port that owns that literal IATA),
   *  `port_alias` (spelling variants), `port_iata` (bare IATA → UN/LOCODE), `port_fragment`
   *  (contains-match on a distinctive fragment). lhs = uppercased punctuation-collapsed key,
   *  rhs = UN/LOCODE. Seeded from the former hardcoded tables; ADMIN-managed at runtime via
   *  Settings → Resolution Rules. */
  async portByCodeOrName(code: string): Promise<{ id: string; country: string | null } | null> {
    const c = code.trim()
    if (!c) return null
    const byUnlocode = async (uloc: string) => {
      const a = await this.db.selectFrom('ports').select(['id', 'country']).where('unlocode', '=', uloc).executeTakeFirst()
      return a ? { id: a.id, country: a.country } : null
    }
    const byCode = await byUnlocode(c.toUpperCase())
    if (byCode) return byCode

    // one read serves all four curated tiers (small, ADMIN-curated table)
    const portFacts = await this.db
      .selectFrom('masterResolution')
      .where('kind', 'in', ['port_abbreviation', 'port_alias', 'port_iata', 'port_fragment'])
      .where('status', '=', 'approved')
      .where('active', '=', true)
      .select(['kind', 'lhs', 'rhs'])
      .execute()
    const factMap = (kind: string) =>
      new Map(portFacts.filter((f) => f.kind === kind && f.rhs).map((f) => [f.lhs.toUpperCase(), String(f.rhs).toUpperCase()]))

    // abbreviation facts run BEFORE the IATA lookup (a common shipping abbreviation may collide with an
    // obscure port's literal IATA). Keyed exact, deterministic.
    const abbrev = factMap('port_abbreviation').get(c.toUpperCase())
    if (abbrev) {
      const a = await byUnlocode(abbrev)
      if (a) return a
    }
    if (/^[A-Za-z]{3}$/.test(c)) {
      const byIata = await this.db
        .selectFrom('ports')
        .select(['id', 'country'])
        .where('iata', '=', c.toUpperCase())
        .orderBy(sql`len(${sql.ref('name')})`)
        .modifyFront(sql`top 1`)
        .executeTakeFirst()
      if (byIata) return { id: byIata.id, country: byIata.country }
    }

    // CURATED ALIAS FACTS (exact-keyed, high-confidence) — checked BEFORE the fuzzy match so a known
    // spelling variant wins. aliasKey = uppercased, punctuation-collapsed input.
    const aliasKey = c.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    // spelling variants → canonical UN/LOCODE ('GOTEBORG'/'GOTHENBURG' → SEGOT)
    const alias = factMap('port_alias').get(aliasKey)
    if (alias) {
      const a = await byUnlocode(alias)
      if (a) return a
    }
    // bare IATA (airport) code → UN/LOCODE ('CKG' → CNCKG/Chongqing). Deterministic, no fuzzy.
    const iata = factMap('port_iata').get(aliasKey)
    if (iata) {
      const a = await byUnlocode(iata)
      if (a) return a
    }
    // full-facility-name fragments → UN/LOCODE ('SHAHAJALAL INTL. AIR PORT' = Dhaka/BDDAC). Contains-match
    // on a distinctive, long fragment so it can't false-hit another port.
    for (const [frag, uloc] of factMap('port_fragment')) {
      if (aliasKey.includes(frag)) {
        const a = await byUnlocode(uloc)
        if (a) return a
      }
    }

    // FUZZY NAME MATCH (last resort) — FORWARD ONLY: the port's official name must CONTAIN the input,
    // or contain the input's leading token ('QINGDAO, CHINA' → 'Qingdao'). We do NOT reverse-match
    // (input contains name): a short port name buried mid-word would hijack the input — 'Tago' (JPTAO)
    // inside 'Chit·tago·ng', or 'China' (JPCHI) inside 'QINGDAO, CHINA'. And we only fuzzy-match inputs
    // ≥4 chars: a 3-char token is a code/IATA (handled above) or junk, and forward-matching it lets IT
    // hijack a longer name ('EHU' ⊂ 'L·ehu·'). Forward-full beats leading-token; shortest official name
    // wins ('SHANGHAI' → 'Shanghai', not 'Shanghai Railway Station').
    if (c.length >= 4) {
      const head = c.split(',')[0]!.trim()
      const useHead = head.length >= 4 && head.toUpperCase() !== c.toUpperCase()
      const full = `%${c.toLowerCase()}%`
      const headPat = `%${head.toLowerCase()}%`
      const nameWhere = useHead
        ? sql<boolean>`len(${sql.ref('name')}) >= 4 AND (LOWER(${sql.ref('name')}) LIKE ${full} OR LOWER(${sql.ref('name')}) LIKE ${headPat})`
        : sql<boolean>`len(${sql.ref('name')}) >= 4 AND LOWER(${sql.ref('name')}) LIKE ${full}`
      const byName = await this.db
        .selectFrom('ports')
        .select(['id', 'country'])
        .where(nameWhere)
        .orderBy(sql`(CASE WHEN LOWER(${sql.ref('name')}) LIKE ${full} THEN 0 ELSE 1 END)`)
        .orderBy(sql`len(${sql.ref('name')})`)
        .orderBy('name')
        .modifyFront(sql`top 1`)
        .executeTakeFirst()
      if (byName) return { id: byName.id, country: byName.country }
    }
    return null
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
  async listCarriers() {
    return this.db.selectFrom('carriers').orderBy('scac').selectAll().execute()
  }
  async carrierByScac(scac: string) {
    const r = await this.db.selectFrom('carriers').selectAll().where('scac', '=', scac.trim().toUpperCase()).executeTakeFirst()
    return r ?? null
  }
  async createCarrier(v: { scac: string; name: string }) {
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
  async listResolution(status: 'approved' | 'proposed' | 'rejected') {
    return this.db.selectFrom('masterResolution').where('status', '=', status).where('active', '=', true).orderBy('createdAt', 'desc').selectAll().execute()
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
