/**
 * The Critic merge policy — how per-email parser records stack into ONE shipment picture.
 * Ported from cobalt-queue/src/critic/merge.ts (the executable spec). Pure functions.
 *
 *   identity (so_no/hbl/mbl/booking_no/container_no) — first wins unless a more authoritative
 *            doc (Final B/L > Draft B/L > SO > Booking) contradicts; disagreements = conflicts.
 *   entity   (customer/vendor/forwarder/consignee) — same as identity.
 *   schedule (cargo_ready/warehouse/etd/atd/eta/in_dc) — LATEST email wins (schedules re-quoted).
 *   quantity (qty) + text (address/item_style/poi/pod) — most authoritative doc wins, ties→newest.
 *   po       (customer_po) — union across the thread.
 */
export type FieldClass = 'identity' | 'entity' | 'schedule' | 'quantity' | 'text' | 'po'

export const FIELD_CLASS: Record<string, FieldClass> = {
  customer_po: 'po',
  so_no: 'identity', hbl_awb_fcr_no: 'identity', mbl: 'identity', booking_no: 'identity', container_no: 'identity',
  customer_code: 'entity', vendor_code: 'entity', forwarder_name: 'entity', consignee_name: 'entity',
  cargo_ready_date: 'schedule', warehouse_start_date: 'schedule', warehouse_end_date: 'schedule',
  etd: 'schedule', atd: 'schedule', eta: 'schedule', in_dc_date: 'schedule',
  qty: 'quantity',
  consignee_address: 'text', item_style_no: 'text', poi: 'text', pod: 'text',
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
    } else if (cls === 'quantity' || cls === 'text') {
      for (const c of stated) if (c.rank >= kept.rank) kept = c // best rank, ties → newest
    } else {
      // identity / entity: first wins unless a more authoritative doc disagrees
      for (const c of stated.slice(1)) {
        if (sameVal(c.value, kept.value)) continue
        if (c.rank > rank(kept.emailType)) {
          conflicts.push(`${field}: '${kept.value}' (${kept.emailType}) → '${c.value}' (${c.emailType})`)
          kept = c
        } else {
          conflicts.push(`${field}: kept '${kept.value}' (${kept.emailType}) vs '${c.value}' (${c.emailType})`)
        }
      }
    }
    out[field] = kept.value
  }
  return { fields: out, pos: [...pos].sort(), conflicts }
}
