import { Injectable } from '@nestjs/common'
import { MastersRepository } from '../db/repositories/masters.repository'
import { trigramSimilarity, tokenMatch, tokenSubset } from './trigram'

/**
 * Deterministic, LLM-free candidate retrieval for the LLM Master Matcher (design 2026-07-09 §3 +
 * T-SQL re-spec 2026-07-10). Recall-oriented: UNION of per-signal candidate sets, scored + ranked;
 * the LLM (cobalt-queue side) makes every final call. Signals:
 *   name   — app-side trigram similarity over master names + forwarder alias values (threshold 0.3)
 *   domain — the input emailDomain vs forwarder `domain` aliases / customers+vendors contactEmail domain
 *   region — a BOOST (never a filter) when countries match
 *   role   — the `type` param scopes which master kind is searched
 *   prior_correction — approved+active master_resolution facts (lhs = raw name|domain → rhs = code),
 *            a top-rank boost so a human-corrected mapping resurfaces as a strong candidate.
 *
 * Masters are a small ERP mirror (≤ a few k rows/kind), refreshed daily — rows are cached in-process
 * for 60s; correctness never depends on the cache.
 */

export type CandidateKind = 'customer' | 'vendor' | 'forwarder' | 'consignee' | 'port'

export interface CandidatesRequest {
  type: CandidateKind
  name?: string | null
  emailDomain?: string | null
  country?: string | null
  limit?: number | null
  /** Phase 2 co-occurrence context from the matcher's shipment group — boosts, never filters. */
  context?: {
    customerCode?: string | null
    poNumbers?: string[] | null
    brand?: string | null
  } | null
}

export interface Candidate {
  code: string | null
  name: string
  type: CandidateKind
  vendorType?: string | null
  mode?: string | null
  country: string | null
  domains: string[]
  aliases: string[]
  signals: string[]
  score: number
}

interface MasterRow {
  code: string | null
  name: string
  type: CandidateKind
  vendorType?: string | null
  mode?: string | null
  country: string | null
  domains: string[]
  aliases: string[]
}

const NAME_THRESHOLD = 0.3
const DEFAULT_LIMIT = 12
const CACHE_TTL_MS = 60_000

/**
 * Built-in free-text spellings for seeded LOCODEs (shiptrack#163 CHATTOGRAM).
 * Merged into candidate aliases so retrieval ranks the LOCODE without requiring ops facts.
 * Ops can still add port_alias facts for one-off spellings.
 */
const BUILTIN_PORT_ALIASES: Record<string, string[]> = {
  BDCGP: ['CHATTOGRAM', 'CHITTAGONG', 'CTG', 'CHITTAGONG PORT'],
}

const domainOf = (email: string | null | undefined): string | null => {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*$/.exec(String(email ?? '').trim())
  return m ? m[1]!.toLowerCase() : null
}
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

const PARTY_KINDS = new Set<CandidateKind>(['customer', 'vendor', 'forwarder', 'consignee'])
function isPartyKind(t: CandidateKind): boolean {
  return PARTY_KINDS.has(t)
}

/**
 * Single brand-like token, length 2–6 (e.g. DSV, MAERSK is 6). Excludes long city names
 * (SHANGHAI = 8) so reverse token-subset does not flood party candidates.
 */
function isShortBrandInput(input: string): boolean {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9一-鿿]+/g, ' ').trim()
  if (!cleaned || /\s/.test(cleaned)) return false
  const alnum = cleaned.replace(/[^A-Z0-9]/g, '')
  // CJK short brands: 2–4 chars; Latin: 2–6
  if (/[一-鿿]/.test(cleaned)) return cleaned.length >= 2 && cleaned.length <= 4
  return alnum.length >= 2 && alnum.length <= 6
}

/** Master code equals short brand, or code is brand + digits (DSV / DSV001). */
function codeMatchesShortBrand(input: string, code: string): boolean {
  const a = norm(input)
  const c = norm(code)
  if (!a || !c) return false
  if (c === a) return true
  return c.startsWith(a) && c.length > a.length && /^[0-9]+$/.test(c.slice(a.length))
}

@Injectable()
export class CandidatesService {
  private cache = new Map<CandidateKind, { at: number; rows: MasterRow[] }>()

  constructor(private readonly repo: MastersRepository) {}

  /**
   * Ranked candidates + catalog meta for cobalt-queue Master Matcher (#163 / queue #128).
   * `mastersEmpty` = zero rows of this type in the mirror (not “name not found”).
   */
  async candidates(req: CandidatesRequest): Promise<{
    candidates: Candidate[]
    mastersEmpty: boolean
    catalogCount: number
  }> {
    const limit = Math.max(1, Math.min(50, req.limit ?? DEFAULT_LIMIT))
    const rows = await this.rowsFor(req.type)
    const catalogCount = rows.length
    const mastersEmpty = catalogCount === 0
    const priors = await this.priorCorrections(req)
    const cooccur = await this.cooccurrence(req)

    const inputName = String(req.name ?? '').trim()
    const inputDomain = String(req.emailDomain ?? '').trim().toLowerCase()
    const inputCountry = String(req.country ?? '').trim().toLowerCase()

    const scored: Candidate[] = []
    for (const r of rows) {
      const signals: string[] = []
      let nameScore = 0
      if (inputName) {
        nameScore = trigramSimilarity(inputName, r.name)
        for (const a of r.aliases) nameScore = Math.max(nameScore, trigramSimilarity(inputName, a))
        if (nameScore >= NAME_THRESHOLD) signals.push(`name:${nameScore.toFixed(2)}`)
        else nameScore = 0
      }
      if (inputName && nameScore === 0) {
        // (1) master tokens ⊆ input — rescues short masters ('DSV') against long raws.
        // (2) port: reverse subset (input ⊆ master) for bare city → airport (live-probe gap).
        // (3) short-brand reverse for parties only: single brand-like token (2–6 chars) that is
        //     a subset of the master ('DSV' → 'DSV AIR AND SEA…'). Cities like 'SHANGHAI' (8 chars)
        //     and logistics generics stay out so we do not flood forwarder candidates.
        const tokenHit =
          tokenMatch(inputName, r.name) ||
          r.aliases.some((a) => tokenMatch(inputName, a)) ||
          (r.type === 'port' && (tokenSubset(inputName, r.name) || r.aliases.some((a) => tokenSubset(inputName, a)))) ||
          (isPartyKind(r.type) &&
            isShortBrandInput(inputName) &&
            (tokenSubset(inputName, r.name) || r.aliases.some((a) => tokenSubset(inputName, a))))
        // code prefix / exact: raw "DSV" must surface master code DSV001 even when name is long
        const codeHit = r.code && isShortBrandInput(inputName) && codeMatchesShortBrand(inputName, r.code)
        if (tokenHit || codeHit) {
          nameScore = codeHit && !tokenHit ? 0.75 : 0.6
          if (tokenHit) signals.push('name:tokens')
          if (codeHit) signals.push('name:code')
        }
      }
      let domainScore = 0
      if (inputDomain && r.domains.length) {
        if (r.domains.includes(inputDomain)) {
          domainScore = 1
          signals.push('domain:exact')
        } else if (r.domains.some((d) => inputDomain.endsWith(`.${d}`) || d.endsWith(`.${inputDomain}`))) {
          domainScore = 0.85
          signals.push('domain:suffix')
        }
      }
      let regionBoost = 0
      if (inputCountry && r.country) {
        const rc = r.country.toLowerCase()
        if (rc === inputCountry || rc.includes(inputCountry) || inputCountry.includes(rc)) {
          regionBoost = 0.1
          signals.push('region:match')
        }
      }
      let priorBoost = 0
      if (r.code && priors.has(r.code.toUpperCase())) {
        priorBoost = 0.3
        signals.push('prior_correction')
      }
      let cooccurBoost = 0
      if (r.code) {
        const c = r.code.toUpperCase()
        for (const [sig, codes, boost] of cooccur) {
          if (codes.has(c)) {
            cooccurBoost += boost
            signals.push(sig)
          }
        }
      }
      const base = Math.max(nameScore, domainScore)
      if (base === 0 && priorBoost === 0 && cooccurBoost === 0) continue // no positive signal → not a candidate
      // additive rank score, deliberately NOT clamped to 1: an exact domain (+0.15 on top of its base)
      // must outrank a perfect lone name match, and a region match must break a name tie — the design's
      // "multiple independent signals beat a lone high name score". Relative order is what matters.
      const exactDomainBonus = domainScore === 1 ? 0.15 : 0
      scored.push({
        code: r.code,
        name: r.name,
        type: r.type,
        vendorType: r.vendorType ?? null,
        mode: r.mode ?? null,
        country: r.country,
        domains: r.domains,
        aliases: r.aliases,
        signals,
        score: base + exactDomainBonus + regionBoost + priorBoost + cooccurBoost,
      })
    }

    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    // dedupe by code (aliases can surface the same master twice), keep the best-scored row
    const seen = new Set<string>()
    const out: Candidate[] = []
    for (const c of scored) {
      const key = c.code ?? `name:${c.name}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
      if (out.length >= limit) break
    }
    return { candidates: out, mastersEmpty, catalogCount }
  }

  /** Phase 2 co-occurrence boosts derived from the request context (history/facts make a candidate more
   *  plausible — always a boost, never a filter). Returns [signal, codeSet, boost] tuples; empty when no
   *  context is supplied, so context-free calls pay zero extra queries. */
  private async cooccurrence(req: CandidatesRequest): Promise<Array<[string, Set<string>, number]>> {
    const ctx = req.context
    if (!ctx) return []
    const out: Array<[string, Set<string>, number]> = []
    if (req.type === 'customer') {
      const pos = (ctx.poNumbers ?? []).filter((p): p is string => !!p && !!p.trim())
      if (pos.length) {
        const codes = await this.repo.customerCodesByPoNumbers(pos)
        if (codes.size) out.push(['cooccur:po', codes, 0.2])
      }
      if (ctx.brand && ctx.brand.trim()) {
        const codes = await this.repo.customerCodesByBrand(ctx.brand)
        if (codes.size) out.push(['brand:match', codes, 0.1])
      }
    } else if ((req.type === 'vendor' || req.type === 'forwarder') && ctx.customerCode && ctx.customerCode.trim()) {
      const cc = ctx.customerCode.trim().toUpperCase()
      const { vendors, forwarders } = await this.repo.cooccurringPartyCodes(cc)
      const historical = req.type === 'vendor' ? vendors : forwarders
      if (historical.size) out.push(['cooccur:customer', historical, 0.15])
      if (req.type === 'vendor') {
        // curated customer_vendor relationship facts — human-stated "this buyer books via this factory"
        const facts = (await this.repo.listResolution('approved')).filter(
          (f) => f.kind === 'customer_vendor' && f.lhs.toUpperCase() === cc && f.rhs,
        )
        const related = new Set(facts.map((f) => String(f.rhs).toUpperCase()))
        if (related.size) out.push(['related:customer_vendor', related, 0.2])
      }
    }
    return out
  }

  /** Approved+active prior_correction codes whose lhs matches the input name (normalized) or domain. */
  private async priorCorrections(req: CandidatesRequest): Promise<Set<string>> {
    const facts = (await this.repo.listResolution('approved')).filter((f) => f.kind === 'prior_correction' && f.rhs)
    const nameKey = req.name ? norm(String(req.name)) : ''
    const domainKey = String(req.emailDomain ?? '').trim().toLowerCase()
    const out = new Set<string>()
    for (const f of facts) {
      const lhs = String(f.lhs)
      const hit = (nameKey && norm(lhs) === nameKey) || (domainKey && lhs.trim().toLowerCase() === domainKey)
      if (hit) out.add(String(f.rhs).toUpperCase())
    }
    return out
  }

  private async rowsFor(kind: CandidateKind): Promise<MasterRow[]> {
    const hit = this.cache.get(kind)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows
    let rows: MasterRow[]
    if (kind === 'customer') {
      // name_ch rides as an alias: trigram/token scoring folds 简↔繁 (cjk-fold), so a simplified
      // document name surfaces a master stored in traditional script — and the LLM sees both.
      rows = (await this.repo.listCustomers()).map((c) => ({
        code: c.code, name: c.name, type: 'customer' as const, country: c.country,
        domains: domainOf(c.contactEmail) ? [domainOf(c.contactEmail)!] : [], aliases: c.nameCh ? [c.nameCh] : [],
      }))
    } else if (kind === 'vendor') {
      rows = (await this.repo.listVendors()).map((v) => ({
        code: v.code, name: v.name, type: 'vendor' as const, vendorType: v.type, country: v.location,
        domains: domainOf(v.contactEmail) ? [domainOf(v.contactEmail)!] : [], aliases: v.nameCh ? [v.nameCh] : [],
      }))
    } else if (kind === 'forwarder') {
      const [fwds, aliases] = await Promise.all([this.repo.listForwarders(), this.repo.listForwarderAliases()])
      const byFwd = new Map<string, { domains: string[]; aliases: string[] }>()
      for (const a of aliases) {
        const slot = byFwd.get(a.forwarderId) ?? { domains: [], aliases: [] }
        if (a.aliasType === 'domain') slot.domains.push(a.value.toLowerCase())
        else slot.aliases.push(a.value)
        byFwd.set(a.forwarderId, slot)
      }
      rows = fwds.map((f) => ({
        code: f.code, name: f.name, type: 'forwarder' as const, country: null,
        domains: byFwd.get(f.id)?.domains ?? [], aliases: byFwd.get(f.id)?.aliases ?? [],
      }))
    } else if (kind === 'port') {
      const [ports, facts] = await Promise.all([this.repo.listPorts(), this.repo.listResolution('approved')])
      const aliasesByUloc = new Map<string, string[]>()
      for (const f of facts) {
        if (!f.rhs) continue
        if (f.kind === 'port_abbreviation' || f.kind === 'port_alias' || f.kind === 'port_iata' || f.kind === 'port_fragment') {
          const u = String(f.rhs).toUpperCase()
          const slot = aliasesByUloc.get(u) ?? []
          slot.push(f.lhs)
          aliasesByUloc.set(u, slot)
        }
      }
      rows = ports.map((p) => {
        const uloc = p.unlocode.toUpperCase()
        const builtin = BUILTIN_PORT_ALIASES[uloc] ?? []
        return {
          code: p.unlocode,
          name: p.name,
          type: 'port' as const,
          country: p.country,
          mode: p.mode,
          domains: [],
          aliases: [
            ...(aliasesByUloc.get(uloc) ?? []),
            ...builtin,
            ...(p.iata ? [p.iata] : []),
          ],
        }
      })
    } else {
      rows = (await this.repo.listConsignees()).map((c) => ({
        // consignees have no code — the LLM matches by name; country derived from address tokens is
        // deferred (design §2: no schema change for MVP)
        code: null, name: c.name, type: 'consignee' as const, country: null, domains: [], aliases: [],
      }))
    }
    this.cache.set(kind, { at: Date.now(), rows })
    return rows
  }
}
