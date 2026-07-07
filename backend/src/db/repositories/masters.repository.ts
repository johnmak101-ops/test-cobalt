import { Inject, Injectable } from '@nestjs/common'
import { and, eq, ilike, desc, sql } from 'drizzle-orm'
import * as schema from '../contracts'
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
    // AMBIGUITY-GUARDED first-stage containment: '%name%' matches an UNORDERED heap scan, so a substring like
    // 'Expeditors' hits 3 masters (EXPEDITORS - CHINA / EXPEDITORS CAMBODIA / EXPEDITORS INTERNATIONAL) and
    // returning the first row is nondeterministic (a VACUUM can flip it). Fetch ALL matches and return ONLY
    // when EXACTLY ONE master contains the name; on 0 or >1, fall through to the deterministic stages below
    // (which correctly return null for a bare ambiguous 'Expeditors', leaving forwarder_raw to surface).
    const contained = await this.db.select().from(schema.forwarders).where(ilike(schema.forwarders.name, `%${name}%`))
    if (contained.length === 1) return contained[0]!.id
    // normalized exact match: strip ALL non-alphanumerics so punctuation/spacing variants resolve
    // ('LX PANTOS LOGISTICS (SHENZHEN) CO.,LTD.' == master 'LX PANTOS LOGISTICS (SHENZHEN) CO. LTD').
    const norm = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (norm.length >= 4) {
      // BUG 6: no .orderBy means .limit(1) picked a heap-order winner — two masters that normalize to the
      // same string (EXPEDITORS 225 vs a duplicate EXDO) could flip on VACUUM. Fetch ALL and return only
      // when EXACTLY ONE matches, mirroring the containment stages; on >1, fall through so forwarder_raw surfaces.
      const n = await this.db
        .select()
        .from(schema.forwarders)
        .where(sql`regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g') = ${norm}`)
      if (n.length === 1) return n[0]!.id
      const na = await this.db
        .select()
        .from(schema.forwarderAliases)
        .where(sql`regexp_replace(upper(${schema.forwarderAliases.value}), '[^A-Z0-9]', '', 'g') = ${norm}`)
      if (na.length === 1) return na[0]!.forwarderId
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
      // BUG 6: same exactly-one guard as the un-stripped normalized stage above (was heap-order .limit(1)).
      const n = await this.db
        .select()
        .from(schema.forwarders)
        .where(sql`regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g') = ${strippedNorm}`)
      if (n.length === 1) return n[0]!.id
      const na = await this.db
        .select()
        .from(schema.forwarderAliases)
        .where(sql`regexp_replace(upper(${schema.forwarderAliases.value}), '[^A-Z0-9]', '', 'g') = ${strippedNorm}`)
      if (na.length === 1) return na[0]!.forwarderId
    }
    // same exactly-one guard on the alias '%name%' ilike — an ambiguous alias substring must not arbitrarily
    // resolve from an unordered heap scan either.
    const aliasContained = await this.db.select().from(schema.forwarderAliases).where(ilike(schema.forwarderAliases.value, `%${name}%`))
    if (aliasContained.length === 1) return aliasContained[0]!.forwarderId
    // BUG 2: an email-form raw like 'om-booking-notifications@expeditors.com (Expeditors)' resolves to NULL
    // above — the whole string contains no master and normalizes to nothing recognizable. But it carries the
    // org identity in TWO deterministic places: the parenthetical CONTENT ('Expeditors') and the domain's
    // second-level label ('expeditors' from expeditors.com). Run EACH such token back through the SAME
    // exactly-one-guarded stages (containment + normalized-exact name/alias) — the seeded alias EXPEDITORS→225
    // resolves 'Expeditors'. Only when EXACTLY ONE token resolves (and never to two different masters) do we
    // accept it; on 0, >1, or an internal ambiguity we fall through to the stages below (raw surfaces).
    const orgTokens: string[] = []
    const parenContent = /\(([^)]*)\)/.exec(name)?.[1]?.trim()
    if (parenContent) orgTokens.push(parenContent)
    // domain second-level label — only when the raw is dominated by an email address (no meaningful text
    // outside the address). expeditors.com → 'expeditors'; skips generic hosts (gmail/outlook/etc.).
    const emailMatch = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(name)
    if (emailMatch) {
      const labels = emailMatch[2]!.toLowerCase().split('.')
      const sld = labels.length >= 2 ? labels[labels.length - 2]! : ''
      const GENERIC_HOSTS = new Set(['gmail', 'outlook', 'hotmail', 'yahoo', 'qq', '163', '126', 'live', 'icloud', 'googlemail'])
      if (sld.length >= 3 && !GENERIC_HOSTS.has(sld)) orgTokens.push(sld)
    }
    let tokenResolved: string | null = null
    for (const tok of orgTokens) {
      const id = await this.resolveForwarderOrgToken(tok)
      if (!id) continue
      if (tokenResolved && tokenResolved !== id) { tokenResolved = null; break } // two tokens disagree → ambiguous
      tokenResolved = id
    }
    if (tokenResolved) return tokenResolved
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
    // BUG 8: also try the CONTENTS of the first parenthetical ('TradeLinkOne (TradeLink Technologies Ltd)' →
    // 'TradeLink Technologies Ltd'). The stripped form drops the parenthetical entirely, so a name whose
    // resolvable identity lives INSIDE the parentheses (an outer brand + an inner legal name) would otherwise
    // miss. The exactly-one guard below keeps it deterministic — inner folds to exactly one master.
    const inner = /\(([^)]*)\)/.exec(name)?.[1]?.trim()
    // try the office/email-stripped form FIRST ('TradeLink Technologies Ltd (…portal, …@…)' → 'TradeLink
    // Technologies Ltd'), then the inner-parenthetical content, then the raw — accept only when EXACTLY ONE
    // master folds to the same canon.
    for (const cand of [stripped, ...(inner ? [inner] : []), name]) {
      const inputFold = foldLegalForm(cand)
      if (inputFold.length < 4) continue
      const hits = foldAll.filter((f) => foldLegalForm(f.name) === inputFold)
      if (hits.length === 1) return hits[0]!.id
    }
    return null
  }

  /**
   * BUG 2 helper: resolve a bare org token ('Expeditors', 'expeditors') extracted from a parenthetical or an
   * email domain, using the SAME deterministic, exactly-one-guarded stages as forwarderIdByName: containment
   * (%tok%) → normalized-exact on the forwarder NAME → normalized-exact on forwarder ALIASES. Returns a
   * forwarder id only when EXACTLY ONE master/alias matches at a stage; on 0 or >1 it returns null so the
   * caller keeps determinism and falls through (raw surfaces). Deliberately NOT recursive.
   */
  private async resolveForwarderOrgToken(token: string): Promise<string | null> {
    const tok = token.trim()
    if (tok.length < 3) return null
    const contained = await this.db.select().from(schema.forwarders).where(ilike(schema.forwarders.name, `%${tok}%`))
    if (contained.length === 1) return contained[0]!.id
    const norm = tok.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (norm.length >= 4) {
      const n = await this.db
        .select()
        .from(schema.forwarders)
        .where(sql`regexp_replace(upper(${schema.forwarders.name}), '[^A-Z0-9]', '', 'g') = ${norm}`)
      if (n.length === 1) return n[0]!.id
      const na = await this.db
        .select()
        .from(schema.forwarderAliases)
        .where(sql`regexp_replace(upper(${schema.forwarderAliases.value}), '[^A-Z0-9]', '', 'g') = ${norm}`)
      if (na.length === 1) return na[0]!.forwarderId
    }
    return null
  }
  async portIdByCodeOrName(code: string) {
    return (await this.portByCodeOrName(code))?.id ?? null
  }
  /** Resolve a POL/POD string to a port (id + country, for denormalizing origin_country at commit).
   *  Order: exact UN/LOCODE → exact IATA (bare 3-char PVG/CAN) → CURATED aliases (spelling / IATA /
   *  name-fragment, high-confidence, exact-keyed) → FORWARD fuzzy name match (last resort). Curated
   *  aliases run BEFORE the fuzzy match so a spelling variant ('Chittagong', stored as 'Chattogram')
   *  can't fall through to a loose substring hit. */
  async portByCodeOrName(code: string): Promise<{ id: string; country: string | null } | null> {
    const c = code.trim()
    if (!c) return null
    const [byCode] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, c.toUpperCase()))
    if (byCode) return { id: byCode.id, country: byCode.country }
    // Common shipping abbreviations whose literal IATA collides with an OBSCURE port — pin them before
    // the IATA lookup ('HCM' = Ho Chi Minh/VNSGN, a top-5 Asian port; its literal IATA 'HCM' belongs to
    // a tiny Somali entry). Keyed exact, deterministic.
    const ABBREV_OVERRIDE: Record<string, string> = { HCM: 'VNSGN' }
    if (ABBREV_OVERRIDE[c.toUpperCase()]) {
      const [a] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, ABBREV_OVERRIDE[c.toUpperCase()]!))
      if (a) return { id: a.id, country: a.country }
    }
    if (/^[A-Za-z]{3}$/.test(c)) {
      const [byIata] = await this.db
        .select()
        .from(schema.ports)
        .where(eq(schema.ports.iata, c.toUpperCase()))
        .orderBy(sql`length(${schema.ports.name})`)
        .limit(1)
      if (byIata) return { id: byIata.id, country: byIata.country }
    }

    // CURATED ALIASES (exact-keyed, high-confidence) — checked BEFORE the fuzzy match so a known
    // spelling variant wins. aliasKey = uppercased, punctuation-collapsed input.
    const aliasKey = c.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    // spelling variants → canonical UN/LOCODE ('GOTEBORG'/'GOTHENBURG' → SEGOT).
    const PORT_ALIASES: Record<string, string> = {
      GOTEBORG: 'SEGOT',
      GOTHENBURG: 'SEGOT',
      KHORFAKKAN: 'AEKLF',
    }
    if (PORT_ALIASES[aliasKey]) {
      const [a] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, PORT_ALIASES[aliasKey]!))
      if (a) return { id: a.id, country: a.country }
    }
    // bare IATA (airport) code → UN/LOCODE ('CKG' → CNCKG/Chongqing). Deterministic, no fuzzy.
    const IATA_TO_UNLOCODE: Record<string, string> = { CKG: 'CNCKG', PNH: 'KHPNH' }
    if (IATA_TO_UNLOCODE[aliasKey]) {
      const [a] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, IATA_TO_UNLOCODE[aliasKey]!))
      if (a) return { id: a.id, country: a.country }
    }
    // full-facility-name fragments → UN/LOCODE ('SHAHAJALAL INTL. AIR PORT' = Dhaka/BDDAC). Contains-match
    // on a distinctive, long fragment so it can't false-hit another port.
    const NAME_CONTAINS_ALIASES: Array<[string, string]> = [
      ['SHAHAJALAL', 'BDDAC'],
      ['SHAHJALAL', 'BDDAC'],
      ['KHOR AL FAKKAN', 'AEKLF'],
      ['KHOR FAKKAN', 'AEKLF'],
      // Chittagong (traditional spelling) — master stores the modern 'Chattogram' (BDCGP). Substring
      // so decorated raws resolve too: 'CHITTAGONG, BANGLADESH', 'CGP (Golden Depot / Chittagong)'.
      ['CHITTAGONG', 'BDCGP'],
      ['CHATTOGRAM', 'BDCGP'],
    ]
    for (const [frag, uloc] of NAME_CONTAINS_ALIASES) {
      if (aliasKey.includes(frag)) {
        const [a] = await this.db.select().from(schema.ports).where(eq(schema.ports.unlocode, uloc))
        if (a) return { id: a.id, country: a.country }
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
      const nameWhere = useHead
        ? sql`length(${schema.ports.name}) >= 4 AND (${schema.ports.name} ILIKE ${`%${c}%`} OR ${schema.ports.name} ILIKE ${`%${head}%`})`
        : sql`length(${schema.ports.name}) >= 4 AND ${schema.ports.name} ILIKE ${`%${c}%`}`
      const [byName] = await this.db
        .select()
        .from(schema.ports)
        .where(nameWhere)
        .orderBy(
          sql`(CASE WHEN ${schema.ports.name} ILIKE ${`%${c}%`} THEN 0 ELSE 1 END)`,
          sql`length(${schema.ports.name})`,
          schema.ports.name,
        )
        .limit(1)
      if (byName) return { id: byName.id, country: byName.country }
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
