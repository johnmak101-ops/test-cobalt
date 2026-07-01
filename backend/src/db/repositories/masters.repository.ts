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
    // normalized exact match: strip ALL non-alphanumerics so punctuation/spacing variants resolve
    // ('LX PANTOS LOGISTICS (SHENZHEN) CO.,LTD.' == master 'LX PANTOS LOGISTICS (SHENZHEN) CO. LTD').
    const norm = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (norm.length >= 4) {
      const [n] = await this.db
        .select()
        .from(schema.forwarders)
        .where(sql`regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g') = ${norm}`)
        .limit(1)
      if (n) return n.id
      const [na] = await this.db
        .select()
        .from(schema.forwarderAliases)
        .where(sql`regexp_replace(upper(${schema.forwarderAliases.value}), '[^A-Z0-9]', '', 'g') = ${norm}`)
        .limit(1)
      if (na) return na.forwarderId
    }
    // strip trailing office/email annotations ('Expeditors International (LAX)', 'Maersk … (lns.maersk.com)',
    // '… <ops@fwd.com>') then retry the SAME normalized-exact match — the parenthetical is not part of the name.
    const stripped = name
      .replace(/\([^)]*\)/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const strippedNorm = stripped.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (strippedNorm.length >= 4 && strippedNorm !== norm) {
      const [n] = await this.db
        .select()
        .from(schema.forwarders)
        .where(sql`regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g') = ${strippedNorm}`)
        .limit(1)
      if (n) return n.id
      const [na] = await this.db
        .select()
        .from(schema.forwarderAliases)
        .where(sql`regexp_replace(upper(${schema.forwarderAliases.value}), '[^A-Z0-9]', '', 'g') = ${strippedNorm}`)
        .limit(1)
      if (na) return na.forwarderId
    }
    const [a] = await this.db.select().from(schema.forwarderAliases).where(ilike(schema.forwarderAliases.value, `%${name}%`))
    if (a) return a.forwarderId
    // reverse-containment: a master whose normalized name is a SUBSTRING of the normalized input, so an
    // input with an appended office/domain ('EXPEDITORS INTERNATIONAL (LAX)') still resolves. Guarded by
    // master-name length ≥ 10 chars (avoids short generic tokens matching everything) and the LONGEST match
    // first (prefer the specific 'MAERSK LOGISTICS & SERVICES CHINA LIMITED' over a bare 'MAERSK').
    if (norm.length >= 10) {
      const [rc] = await this.db
        .select()
        .from(schema.forwarders)
        .where(
          sql`length(regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g')) >= 10 AND ${norm} LIKE '%' || regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g') || '%'`,
        )
        .orderBy(desc(sql`length(${schema.forwarders.name})`))
        .limit(1)
      if (rc) return rc.id
    }
    // legal-form fold: 'TradeLink Technologies Ltd' should reach master 'TRADELINK TECHNOLOGIES LIMITED'.
    // Canonicalize the trailing legal-form token (LTD↔LIMITED, CO↔COMPANY, INC↔INCORPORATED,
    // CORP↔CORPORATION) on BOTH the input and every master, then compare. DANGER: the table holds 50+
    // pairs that differ ONLY by legal form as distinct coded rows (019/020 AGILITY, 630/631 U-OCEAN,
    // 572/573 STANDARD FREIGHT HK, WAN HAI LINES ×2) — a blind fold + limit(1) would resolve those
    // nondeterministically. So accept the folded match ONLY when EXACTLY ONE forwarder folds to it.
    const foldLegalForm = (s: string): string => {
      // normalize to alnum-separated-by-single-space tokens, then rewrite legal-form tokens to a canon.
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
    const foldAll = await this.db.select({ id: schema.forwarders.id, name: schema.forwarders.name }).from(schema.forwarders)
    // try the office/email-stripped form FIRST ('TradeLink Technologies Ltd (…portal, …@…)' → 'TradeLink
    // Technologies Ltd'), then the raw — accept only when EXACTLY ONE master folds to the same canon.
    for (const cand of [stripped, name]) {
      const inputFold = foldLegalForm(cand)
      if (inputFold.length < 4) continue
      const hits = foldAll.filter((f) => foldLegalForm(f.name) === inputFold)
      if (hits.length === 1) return hits[0]!.id
    }
    return null
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
    if (byName) return { id: byName.id, country: byName.country }
    // spelling-variant fallback: a small, deterministic alias map (no fuzzy matching — false hits on ports
    // are worse than a miss). Uppercased + punctuation-collapsed input keys onto the canonical UN/LOCODE,
    // then re-run the exact-unlocode lookup ('GOTEBORG'/'GOTHENBURG' → SEGOT; 'KHOR AL FAKKAN' → AEKLF).
    const PORT_ALIASES: Record<string, string> = {
      GOTEBORG: 'SEGOT',
      GOTHENBURG: 'SEGOT',
      KHORFAKKAN: 'AEKLF',
    }
    const aliasKey = c.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const aliasCode = PORT_ALIASES[aliasKey]
    if (aliasCode) {
      const [byAlias] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, aliasCode))
      if (byAlias) return { id: byAlias.id, country: byAlias.country }
    }
    // curated IATA (airport) code → UN/LOCODE aliases, so a bare air code like 'CKG' resolves to the seeded
    // 'CNCKG'/Chongqing entry. Deterministic, no fuzzy — re-runs the exact-unlocode lookup on the mapped code.
    const IATA_TO_UNLOCODE: Record<string, string> = {
      CKG: 'CNCKG',
      PNH: 'KHPNH',
    }
    const iataCode = IATA_TO_UNLOCODE[aliasKey]
    if (iataCode) {
      const [byIata] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, iataCode))
      if (byIata) return { id: byIata.id, country: byIata.country }
    }
    // airport/port NAME fragments → UN/LOCODE. The raw is often a full facility name ('SHAHAJALAL INTL. AIR
    // PORT' = Dhaka/BDDAC) that neither the ILIKE name match nor an exact alias key catches. Contains-match on
    // a distinctive, long fragment so it can't false-hit another port.
    const NAME_CONTAINS_ALIASES: Array<[string, string]> = [
      ['SHAHAJALAL', 'BDDAC'],
      ['SHAHJALAL', 'BDDAC'],
      ['KHOR AL FAKKAN', 'AEKLF'],
      ['KHOR FAKKAN', 'AEKLF'],
    ]
    for (const [frag, uloc] of NAME_CONTAINS_ALIASES) {
      if (aliasKey.includes(frag)) {
        const [byFrag] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, uloc))
        if (byFrag) return { id: byFrag.id, country: byFrag.country }
      }
    }
    return null
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
