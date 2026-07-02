import { normKey, str, num } from './match-keys'
import { QTY_UNIT } from '@cobalt/contracts'

/** The per-PO facts pulled from parsed evidence, ready to enrich purchase_orders. */
export interface PoEnrichment {
  brand: string | null
  itemStyleNo: string | null
  totalQuantity: number | null
  quantityUnit: (typeof QTY_UNIT)[number] | null
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

    const enr: PoEnrichment = { brand: null, itemStyleNo: null, totalQuantity: null, quantityUnit: null }
    for (const r of ordered) {
      const f = r.fields ?? {}
      if (enr.brand == null) enr.brand = str(f.brand)
      if (enr.itemStyleNo == null) enr.itemStyleNo = str(f.item_style_no)
      if (enr.totalQuantity == null && !qtyIsBroadcast(r)) {
        const q = num(f.qty)
        if (q != null) {
          enr.totalQuantity = q
          enr.quantityUnit = validUnit(f.qty_unit) // bound to the same record as the qty
        }
      }
    }
    out.set(key, enr)
  }
  return out
}
