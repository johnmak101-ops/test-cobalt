/**
 * The Critic merge policy — how per-email parser records stack into ONE shipment picture.
 * KEEP THE CONFLICT SEMANTICS IN SYNC WITH cobalt-queue/src/critic/merge.ts (the executable spec);
 * this is the same policy applied on the manual reconcile-from-evidence path. Pure functions.
 *
 *   identity (so_no/hbl/mbl/booking_no/container_no) — most authoritative doc wins; a different-RANK
 *            restatement (Draft → Final B/L) is a lifecycle SUPERSEDE (no conflict), an EQUAL-rank
 *            clash is a real CONFLICT. sameId folds office-prefix variants (SZA26050003 ≡ A26050003).
 *   entity   CODES (customer/vendor) match exactly, any clash = conflict. NAMES (forwarder/consignee)
 *            match by containment ignoring resolver annotations; the most authoritative doc's name
 *            wins (Final B/L consignee beats a lower-rank mis-extraction), only an EQUAL-rank clash.
 *   schedule (cargo_ready/warehouse/etd/atd/eta/ata/in_dc) — LATEST email wins (schedules re-quoted).
 *   quantity (qty) + text (address/poi/pol/pod/vessel/voyage/scac/…) — most authoritative doc wins, ties→newest.
 *   list     (item_style_no/hts_code) — UNION of every stated comma-list across the thread (deduped).
 *   po       (customer_po) — union across the thread.
 */
export type FieldClass = 'identity' | 'entity' | 'schedule' | 'quantity' | 'text' | 'po' | 'list'

export const FIELD_CLASS: Record<string, FieldClass> = {
  customer_po: 'po',
  so_no: 'identity', hbl_awb_fcr_no: 'identity', mbl: 'identity', booking_no: 'identity', container_no: 'identity',
  customer_code: 'entity', vendor_code: 'entity', forwarder_name: 'entity', consignee_name: 'entity',
  cargo_ready_date: 'schedule', warehouse_start_date: 'schedule', warehouse_end_date: 'schedule',
  etd: 'schedule', atd: 'schedule', eta: 'schedule', ata: 'schedule', in_dc_date: 'schedule',
  qty: 'quantity',
  poi: 'text', pol: 'text', pod: 'text', consignee_address: 'text',
  // "extract all info" fields — MUST be listed or mergeShipment silently DROPS them on the reconcile-from-
  // evidence path (they never reach the rebuilt shipment). Mirrors cobalt-queue critic/merge FIELD_CLASS coverage.
  vessel_name: 'text', voyage_no: 'text', flight_no: 'text', mawb: 'text', scac_code: 'text', brand: 'text',
  qty_unit: 'text', gross_weight: 'text', measurement: 'text',
  item_style_no: 'list', hts_code: 'list',
}

export const DOC_RANK: Record<string, number> = {
  'Final B/L': 5, 'Telex Release': 5, 'Draft B/L': 4, SO: 3, 'Booking Request': 2,
  'Invoice/Billing': 1, Customs: 1, Other: 1,
}
const rank = (t?: string | null): number => DOC_RANK[t ?? ''] ?? 1

export interface CriticEmail {
  receivedAt: string // ISO-sortable
  emailType: string
  fields: Record<string, unknown>
  pos?: string[]
}
export interface MergeResult {
  fields: Record<string, unknown>
  pos: string[]
  conflicts: string[]
}

const alnum = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const sameVal = (a: unknown, b: unknown) => alnum(a) === alnum(b)
/** same identifier modulo a short (≤3) all-letter office/carrier prefix — SZA26050003 ≡ A26050003 */
const sameId = (a: unknown, b: unknown): boolean => {
  const x = alnum(a), y = alnum(b)
  if (!x || !y) return x === y
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  if (short.length >= 6 && long.endsWith(short)) {
    const prefix = long.slice(0, long.length - short.length)
    return prefix.length <= 3 && /^[A-Z]+$/.test(prefix)
  }
  return false
}
/** same party modulo a suffix/format variant or resolver annotation — WYSE LONDON ≡ WYSE LONDON LTD,
 *  STRAUSS (maps to ELGC) ≡ STRAUSS OPERATIONS */
const sameName = (a: unknown, b: unknown): boolean => {
  const clean = (s: unknown) => alnum(String(s ?? '').replace(/\([^)]*\)/g, ' '))
  const x = clean(a), y = clean(b)
  if (!x || !y) return x === y
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 4 && long.includes(short)
}
const present = (v: unknown) => v != null && v !== ''

export function mergeShipment(emails: CriticEmail[]): MergeResult {
  const sorted = [...emails].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const out: Record<string, unknown> = {}
  const conflicts: string[] = []
  const pos = new Set<string>()
  for (const e of sorted) for (const p of e.pos ?? []) if (p) pos.add(p)

  for (const [field, cls] of Object.entries(FIELD_CLASS)) {
    if (cls === 'po') continue
    const stated = sorted
      .filter((e) => present(e.fields[field]))
      .map((e) => ({ value: e.fields[field], emailType: e.emailType, rank: rank(e.emailType) }))
    if (!stated.length) continue

    let kept = stated[0]
    if (cls === 'schedule') {
      kept = stated[stated.length - 1] // latest statement supersedes
    } else if (cls === 'list') {
      // union EVERY stated comma-list across records (styles/HTS pile up per PO sheet + B/L rider);
      // order-preserving, case-insensitive dedup. Keeping one record's value lost the rest.
      const seen = new Set<string>()
      const parts: string[] = []
      for (const c of stated)
        for (const t of String(c.value ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
          const k = t.toUpperCase()
          if (!seen.has(k)) {
            seen.add(k)
            parts.push(t)
          }
        }
      kept = { ...kept, value: parts.length ? parts.join(',') : kept.value }
    } else if (cls === 'quantity' || cls === 'text') {
      for (const c of stated) if (c.rank >= kept.rank) kept = c // best rank, ties → newest
    } else {
      // identity / entity — a different-RANK identity matures cleanly (SUPERSEDE, not a problem);
      // a genuine CONFLICT is an EQUAL-rank clash, or ANY entity/party clash (parties don't mature).
      const same = cls === 'identity' ? sameId : field === 'forwarder_name' || field === 'consignee_name' ? sameName : sameVal
      for (const c of stated.slice(1)) {
        if (same(c.value, kept.value)) {
          if (alnum(c.value).length > alnum(kept.value).length) kept = c // keep the fuller form
          continue
        }
        const dr = rank(kept.emailType)
        const higher = c.rank > dr
        // entity CODES must not differ (any clash = conflict); identity + entity NAMES are rank-based
        // (higher-rank wins cleanly; only an equal-rank clash is a conflict)
        const isCode = cls === 'entity' && field !== 'forwarder_name' && field !== 'consignee_name'
        const isConflict = isCode || c.rank === dr
        let oldVal: unknown, oldType: string, newVal: unknown, newType: string
        if (higher) {
          oldVal = kept.value; oldType = kept.emailType; newVal = c.value; newType = c.emailType
          kept = c
        } else {
          oldVal = c.value; oldType = c.emailType; newVal = kept.value; newType = kept.emailType
        }
        if (isConflict) conflicts.push(`${field}: kept '${newVal}' (${newType}) vs '${oldVal}' (${oldType})`)
        // else: lifecycle supersede / stale restatement — the authoritative value wins, no conflict
      }
    }
    out[field] = kept.value
  }
  return { fields: out, pos: [...pos].sort(), conflicts }
}
