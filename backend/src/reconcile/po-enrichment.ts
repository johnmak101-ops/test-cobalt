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
      if (enr.totalQuantity == null) {
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
