import { Injectable } from '@nestjs/common'
import { MastersRepository } from '../db/repositories/masters.repository'
import { trigramSimilarity } from './trigram'

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

export type CandidateKind = 'customer' | 'vendor' | 'forwarder' | 'consignee'

export interface CandidatesRequest {
  type: CandidateKind
  name?: string | null
  emailDomain?: string | null
  country?: string | null
  limit?: number | null
}

export interface Candidate {
  code: string | null
  name: string
  type: CandidateKind
  vendorType?: string | null
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
  country: string | null
  domains: string[]
  aliases: string[]
}

const NAME_THRESHOLD = 0.3
const DEFAULT_LIMIT = 12
const CACHE_TTL_MS = 60_000

const domainOf = (email: string | null | undefined): string | null => {
  const m = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*$/.exec(String(email ?? '').trim())
  return m ? m[1]!.toLowerCase() : null
}
const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

@Injectable()
export class CandidatesService {
  private cache = new Map<CandidateKind, { at: number; rows: MasterRow[] }>()

  constructor(private readonly repo: MastersRepository) {}

  async candidates(req: CandidatesRequest): Promise<{ candidates: Candidate[] }> {
    const limit = Math.max(1, Math.min(50, req.limit ?? DEFAULT_LIMIT))
    const rows = await this.rowsFor(req.type)
    const priors = await this.priorCorrections(req)

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
      const base = Math.max(nameScore, domainScore)
      if (base === 0 && priorBoost === 0) continue // no positive signal → not a candidate
      // additive rank score, deliberately NOT clamped to 1: an exact domain (+0.15 on top of its base)
      // must outrank a perfect lone name match, and a region match must break a name tie — the design's
      // "multiple independent signals beat a lone high name score". Relative order is what matters.
      const exactDomainBonus = domainScore === 1 ? 0.15 : 0
      scored.push({
        code: r.code,
        name: r.name,
        type: r.type,
        vendorType: r.vendorType ?? null,
        country: r.country,
        domains: r.domains,
        aliases: r.aliases,
        signals,
        score: base + exactDomainBonus + regionBoost + priorBoost,
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
    return { candidates: out }
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
      rows = (await this.repo.listCustomers()).map((c) => ({
        code: c.code, name: c.name, type: 'customer' as const, country: c.country,
        domains: domainOf(c.contactEmail) ? [domainOf(c.contactEmail)!] : [], aliases: [],
      }))
    } else if (kind === 'vendor') {
      rows = (await this.repo.listVendors()).map((v) => ({
        code: v.code, name: v.name, type: 'vendor' as const, vendorType: v.type, country: v.location,
        domains: domainOf(v.contactEmail) ? [domainOf(v.contactEmail)!] : [], aliases: [],
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
