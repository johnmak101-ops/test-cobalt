import { normKey, str, num } from './match-keys'
import { QTY_UNIT } from '../db/enums'

/** The per-PO facts pulled from parsed evidence, ready to enrich purchase_orders. The first four fields
 *  are the enrichment payload (consumed by upsertPo); the trailing flags are de-correction review-signals
 *  the committer surfaces as leg reviewReasons — they are NOT written to purchase_orders. */
export interface PoEnrichment {
  brand: string | null
  itemStyleNo: string | null
  totalQuantity: number | null
  quantityUnit: (typeof QTY_UNIT)[number] | null
  /** the kept total_quantity is a same-value-across-≥3-POs broadcast, not a per-PO fact — flag, don't drop */
  broadcastSuspected: boolean
  /** ≥2 diverging brand labels on this PO across the thread (newest kept); the competing values to verify */
  brandConflict: string[] | null
  /** ≥2 diverging item_style_no values on this PO (newest kept); the competing values to verify */
  styleConflict: string[] | null
}

/** A parsed_record row (structurally a subset of EvidenceRepository.EvidenceRow). */
export interface PoEvidenceInput {
  id: string
  poNo: string | null
  matchKeys: Record<string, unknown> | null
  fields: Record<string, unknown> | null
  receivedAt: Date | null
  /** queue_message id — broadcast detection groups records by their source email */
  messageId?: string | null
}

const validUnit = (v: unknown): PoEnrichment['quantityUnit'] => {
  const s = str(v)?.toLowerCase() ?? null
  return s && (QTY_UNIT as readonly string[]).includes(s) ? (s as PoEnrichment['quantityUnit']) : null
}

/** The PO this record speaks for: its own po_no, else the customer_po match-key. Neither → belongs to no PO. */
const poKeyOf = (r: PoEvidenceInput): string => normKey(r.poNo) || normKey(r.matchKeys?.customer_po)

/**
 * Resolve per-PO brand / item_style_no / total_quantity(+unit) from parsed evidence, keyed by normalized PO.
 *
 * Each field is taken from the LATEST-received email that states a non-null value for it (per-field
 * coalescing), which is the deterministic tie-break for the parser brand-leak — the same PO showing two
 * brands across a thread resolves to whichever the newest email carried. total_quantity and its unit are
 * taken TOGETHER from the newest record that has a qty (so the unit always matches the number), and the unit
 * stays null when there is no qty. A record with no PO of its own (a shipment/SO-level brand statement)
 * belongs to no PO and is dropped — this is what stops the aggregate brand from leaking onto every PO.
 */
export function resolvePoEnrichment(rows: PoEvidenceInput[]): Map<string, PoEnrichment> {
  const byPo = new Map<string, PoEvidenceInput[]>()
  for (const r of rows) {
    const key = poKeyOf(r)
    if (!key) continue
    ;(byPo.get(key) ?? byPo.set(key, []).get(key)!).push(r)
  }

  // BROADCAST GUARD: per-PO records stating ONE identical qty across ≥3 distinct POs are
  // broadcasting a TOTAL, never a per-PO fact — checked at two scopes:
  //   • whole email (a 收仓数据 email states one 168-carton total for 20 POs), and
  //   • per booking within the email (a multi-booking table stamps each booking's carton
  //     SUBTOTAL on its POs — ten 123229 POs all "59" beside two 123088 POs all "17" reads
  //     as "mixed" email-wide, but each booking group is uniform).
  // Those records contribute NO qty (brand/style still count). The uniformity-within-scope
  // condition is what separates it from a REAL per-PO column: a 进仓单 table where qty 2
  // repeats on many POs alongside 18s and 1s is mixed-value → all its quantities are real.
  const broadcastQty = new Set<string>() // `${messageId}|${qty}`
  {
    const perScope = new Map<string, { msg: string; qmap: Map<number, Set<string>> }>()
    for (const r of rows) {
      const key = poKeyOf(r)
      const msg = r.messageId
      if (!key || !msg) continue
      const q = num(r.fields?.qty)
      if (q == null) continue
      const booking = normKey(r.fields?.booking_no)
      for (const scope of [msg, `${msg}#${booking}`]) {
        const s = perScope.get(scope) ?? perScope.set(scope, { msg, qmap: new Map() }).get(scope)!
        const pos = s.qmap.get(q) ?? s.qmap.set(q, new Set()).get(q)!
        pos.add(key)
      }
    }
    for (const { msg, qmap } of perScope.values()) {
      // A broadcast value is a TOTAL, so it is ≥ every other value in its scope. A genuinely
      // repeated per-PO count sits BELOW its scope's max (进仓单: 2 repeats beside 18s) and one
      // stray record from another order (76×12 beside a 17) must not disguise the total as "mixed".
      const max = Math.max(...qmap.keys())
      for (const [q, pos] of qmap) {
        if (pos.size >= 3 && q === max) broadcastQty.add(`${msg}|${q}`)
      }
    }
  }
  const qtyIsBroadcast = (r: PoEvidenceInput): boolean => {
    const q = num(r.fields?.qty)
    return q != null && !!r.messageId && broadcastQty.has(`${r.messageId}|${q}`)
  }

  const out = new Map<string, PoEnrichment>()
  for (const [key, group] of byPo) {
    // latest received first; null receivedAt sorts last; id breaks ties deterministically.
    const ordered = [...group].sort((a, b) => {
      const ta = a.receivedAt ? a.receivedAt.getTime() : -Infinity
      const tb = b.receivedAt ? b.receivedAt.getTime() : -Infinity
      if (tb !== ta) return tb - ta
      return String(b.id).localeCompare(String(a.id))
    })

    const enr: PoEnrichment = {
      brand: null, itemStyleNo: null, totalQuantity: null, quantityUnit: null,
      broadcastSuspected: false, brandConflict: null, styleConflict: null,
    }
    // newest broadcast qty, used ONLY as a fallback when no genuine per-PO qty exists for this PO —
    // de-correction (b1): keep the model's value + flag it, instead of silently dropping to null.
    let broadcastFallback: { q: number; unit: PoEnrichment['quantityUnit'] } | null = null
    const brands: string[] = []
    const styles: string[] = []
    for (const r of ordered) {
      const f = r.fields ?? {}
      const b = str(f.brand)
      if (b) brands.push(b)
      const sty = str(f.item_style_no)
      if (sty) styles.push(sty)
      if (enr.brand == null) enr.brand = b
      // item_style: first non-null in newest-first order is provisional; may be upgraded by OCR family pick below
      if (enr.itemStyleNo == null) enr.itemStyleNo = sty
      if (enr.totalQuantity == null) {
        const q = num(f.qty)
        if (q != null) {
          if (!qtyIsBroadcast(r)) {
            enr.totalQuantity = q
            enr.quantityUnit = validUnit(f.qty_unit) // bound to the same record as the qty
          } else if (broadcastFallback == null) {
            broadcastFallback = { q, unit: validUnit(f.qty_unit) }
          }
        }
      }
    }
    // #124: among OCR near-homoglyph styles, keep the letter-suffix form even if an older PDF reading
    // lost to a newer screenshot under pure newest-first (PS1 beats 951 within the same family).
    if (styles.length >= 2) {
      const fam0 = styleFamilyKey(styles[0]!)
      if (fam0.length >= 8 && styles.every((s) => styleFamilyKey(s) === fam0)) {
        enr.itemStyleNo = styles.reduce((a, b) => (styleLetterScore(b) > styleLetterScore(a) ? b : a))
      }
    }
    // No genuine per-PO qty found, only a broadcast total: keep it (fill purchase_orders.total_quantity)
    // and flag it for review — the raw model value stays visible instead of being silently nulled.
    if (enr.totalQuantity == null && broadcastFallback != null) {
      enr.totalQuantity = broadcastFallback.q
      enr.quantityUnit = broadcastFallback.unit
      enr.broadcastSuspected = true
    }
    // de-correction (b2): surface a per-PO brand/style CONFLICT instead of silently resolving to newest.
    // Brand: collapse code↔name (PRMK vs primark) and case variants before flagging.
    const brandRes = resolveBrandLabels(brands)
    if (brandRes.canonical) enr.brand = brandRes.canonical
    enr.brandConflict = brandRes.conflict
    enr.styleConflict = conflictingValues(styles)
    out.set(key, enr)
  }
  return out
}

/**
 * OCR near-homoglyph family key for style codes (#124) — clusters W S6FS007PS1 / W56FS007951 etc.
 * Used only to collapse conflict noise, not to invent values.
 */
export function styleFamilyKey(raw: string): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/5/g, 'S')
    .replace(/6/g, 'G')
    .replace(/9/g, 'P')
    .replace(/8/g, 'E')
}

/** Prefer letter suffixes (PS1) over digit-corrupted OCR (951). */
export function styleLetterScore(raw: string): number {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const tail = s.slice(-3)
  const letters = (tail.match(/[A-Z]/g) ?? []).length
  const digits = (tail.match(/\d/g) ?? []).length
  return letters * 10 - digits + (/\s/.test(String(raw)) ? 1 : 0)
}

/**
 * The distinct competing values a human must reconcile, or null when there is no real conflict. Dedupes,
 * then drops any value whose comma-token set is a SUBSET of another's, so a narrowing ('33058,43078' →
 * '33058') is not treated as a conflict while two disjoint labels ('FENIX' vs 'Barbour') are.
 * #124: also collapses OCR near-homoglyph style families (PS1 vs 951) to a single preferred form.
 * Order follows first appearance (the resolve loop feeds it newest-first). >1 survivor ⇒ conflict.
 */
export function conflictingValues(values: string[]): string[] | null {
  const distinct = [...new Set(values)]
  if (distinct.length < 2) return null
  const tokens = (v: string): Set<string> => new Set(v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))
  const sets = distinct.map((v) => ({ v, t: tokens(v) }))
  const subsetOfOther = (s: { v: string; t: Set<string> }): boolean =>
    sets.some((o) => o !== s && o.t.size > s.t.size && [...s.t].every((x) => o.t.has(x)))
  let survivors = sets.filter((s) => !subsetOfOther(s)).map((s) => s.v)

  // #124 OCR family collapse: if every survivor is the same styleFamilyKey, keep only the best letter-form
  if (survivors.length >= 2) {
    const fam = styleFamilyKey(survivors[0]!)
    if (fam.length >= 8 && survivors.every((v) => styleFamilyKey(v) === fam)) {
      survivors = [
        survivors.reduce((a, b) => (styleLetterScore(b) > styleLetterScore(a) ? b : a)),
      ]
    }
  }
  return survivors.length >= 2 ? survivors : null
}

const brandAlnum = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** 3–6 letter token that looks like a mesh/brand code (PRMK, FENIX, BARB). */
export function isBrandCodeLike(v: string): boolean {
  const a = brandAlnum(v)
  return a.length >= 3 && a.length <= 6 && /^[A-Z]+$/.test(a)
}

/**
 * True when `code` is an ordered-letter acronym of `name` (PRMK ⊂ PRIMARK, BARB ⊂ BARBOUR).
 * Rejects unrelated short/long pairs (FENIX ⊄ BARBOUR).
 */
export function isBrandCodeForName(code: string, name: string): boolean {
  const c = brandAlnum(code)
  const n = brandAlnum(name)
  if (!isBrandCodeLike(code) || n.length <= c.length) return false
  let i = 0
  for (const ch of n) {
    if (ch === c[i]) i++
    if (i === c.length) return true
  }
  return false
}

/**
 * Collapse brand labels that are the same buyer under different surface forms:
 * case (primark/PRIMARK), code↔name (PRMK/primark). Prefer short code when present.
 * Returns canonical brand + conflict set (null when only synonyms remain).
 */
export function resolveBrandLabels(brands: string[]): {
  canonical: string | null
  conflict: string[] | null
} {
  if (!brands.length) return { canonical: null, conflict: null }
  // Case-insensitive dedupe, keep first appearance (newest-first from caller)
  const byUpper = new Map<string, string>()
  for (const b of brands) {
    const u = b.trim()
    if (!u) continue
    const k = u.toUpperCase()
    if (!byUpper.has(k)) byUpper.set(k, u)
  }
  let survivors = [...byUpper.values()]

  // Collapse code↔name pairs: drop the full name when a matching code is present
  const drop = new Set<string>()
  for (let i = 0; i < survivors.length; i++) {
    for (let j = 0; j < survivors.length; j++) {
      if (i === j) continue
      const a = survivors[i]!
      const b = survivors[j]!
      if (isBrandCodeForName(a, b)) drop.add(b) // drop name, keep code
      else if (isBrandCodeForName(b, a)) drop.add(a)
    }
  }
  survivors = survivors.filter((v) => !drop.has(v))

  // Prefer short code among remaining synonyms; else first (newest)
  const codes = survivors.filter((v) => isBrandCodeLike(v))
  const canonical = codes[0] ?? survivors[0] ?? null
  const conflict = survivors.length >= 2 ? survivors : null
  return { canonical, conflict }
}

/**
 * Brand / item_style_no stated on a record that belongs to NO PO (no po_no and no customer_po match-key).
 * The current resolve pass silently drops these (they must not leak onto every PO — the LLM did not say
 * per-PO). de-correction (b2): return them WITH their match-keys so the committer can flag them for a human
 * on the shipment whose identity they share, instead of dropping them without a trace. */
export interface UnattributedStatement {
  field: 'brand' | 'item_style_no'
  value: string
  matchKeys: Record<string, unknown>
}
export function unattributedBrandStyle(rows: PoEvidenceInput[]): UnattributedStatement[] {
  const out: UnattributedStatement[] = []
  for (const r of rows) {
    if (poKeyOf(r)) continue // has a PO → attributed (or already broadcast-handled), not a silent no-PO drop
    const mk = r.matchKeys ?? {}
    const b = str(r.fields?.brand)
    if (b) out.push({ field: 'brand', value: b, matchKeys: mk })
    const s = str(r.fields?.item_style_no)
    if (s) out.push({ field: 'item_style_no', value: s, matchKeys: mk })
  }
  return out
}
