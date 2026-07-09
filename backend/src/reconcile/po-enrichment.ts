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
    // No genuine per-PO qty found, only a broadcast total: keep it (fill purchase_orders.total_quantity)
    // and flag it for review — the raw model value stays visible instead of being silently nulled.
    if (enr.totalQuantity == null && broadcastFallback != null) {
      enr.totalQuantity = broadcastFallback.q
      enr.quantityUnit = broadcastFallback.unit
      enr.broadcastSuspected = true
    }
    // de-correction (b2): surface a per-PO brand/style CONFLICT instead of silently resolving to newest.
    enr.brandConflict = conflictingValues(brands)
    enr.styleConflict = conflictingValues(styles)
    out.set(key, enr)
  }
  return out
}

/**
 * The distinct competing values a human must reconcile, or null when there is no real conflict. Dedupes,
 * then drops any value whose comma-token set is a SUBSET of another's, so a narrowing ('33058,43078' →
 * '33058') is not treated as a conflict while two disjoint labels ('FENIX' vs 'Barbour') are. Order follows
 * first appearance (the resolve loop feeds it newest-first). >1 survivor ⇒ conflict.
 */
export function conflictingValues(values: string[]): string[] | null {
  const distinct = [...new Set(values)]
  if (distinct.length < 2) return null
  const tokens = (v: string): Set<string> => new Set(v.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))
  const sets = distinct.map((v) => ({ v, t: tokens(v) }))
  const subsetOfOther = (s: { v: string; t: Set<string> }): boolean =>
    sets.some((o) => o !== s && o.t.size > s.t.size && [...s.t].every((x) => o.t.has(x)))
  const survivors = sets.filter((s) => !subsetOfOther(s)).map((s) => s.v)
  return survivors.length >= 2 ? survivors : null
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
