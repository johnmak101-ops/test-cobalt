/**
 * The Critic merge policy — how per-email parser records stack into ONE shipment picture.
 * KEEP THE CONFLICT SEMANTICS IN SYNC WITH cobalt-queue/src/critic/merge.ts (the executable spec);
 * this is the same policy applied on the manual reconcile-from-evidence path. Pure functions.
 *
 * Cross-repo sync contract (queue: src/critic/merge.ts) — #117 aligned equal-rank identity:
 *   - Tables (FIELD_CLASS + DOC_RANK) guarded by backend/test/fixtures/merge-policy.fixture.json (Part B).
 *   - Behaviors guarded by backend/test/fixtures/merge-behavior.cases.json (Part C).
 *   - Known divergences (this rebuild path):
 *       · DOCUMENT: known-code-beats-unknown is not ported (no master-membership access here).
 *       · DOCUMENT: segment-time (sentAt) recency is not ported (rebuild rows lack per-segment times).
 *       · DOCUMENT: full identifiers[] / supersedes[] co-current identity history is queue-only;
 *         equal-rank co-current identities surface here as notes[] (not conflicts[]), and the kept
 *         field value is one of them (arrival-order / higher-rank pick). Sequence-token drop + LOCODE
 *         pol/pod tie-break ARE ported. notes[] mirrors queue merge-adjustment notes where applicable.
 *
 * Policy by field class:
 *   identity (so_no/hbl/mbl/booking_no/container_no/warehouse_so) — most authoritative doc wins; a different-RANK
 *            restatement (Draft → Final B/L) is a lifecycle SUPERSEDE (no conflict). An EQUAL-rank
 *            DISTINCT value is a CO-CURRENT member (consolidation / multi-HBL), NOT a conflict — note
 *            only (#117 / queue merge.ts). sameId folds office-prefix variants. Bare ≤3-digit sequence
 *            tokens ('001') are dropped. warehouse_so is 入仓/订仓 — not dual-written to so_no.
 *   entity   CODES (customer/vendor) match exactly, any clash = conflict. NAMES (forwarder/consignee)
 *            match by containment; higher-rank wins cleanly; only an EQUAL-rank name clash conflicts.
 *   schedule (cargo_ready/warehouse/etd/atd/eta/ata/in_dc) — LATEST email wins (schedules re-quoted).
 *   quantity (qty) + text (address/pol/pod/vessel/voyage/scac/…) — most authoritative doc wins, ties→newest.
 *            pol/pod: on equal rank, a clean UN/LOCODE beats a free-text country blob.
 *   list     (item_style_no/hts_code) — UNION of every stated comma-list across the thread (deduped).
 *   po       (customer_po) — union across the thread.
 */
import { isSequenceToken } from './match-keys'

export type FieldClass = 'identity' | 'entity' | 'schedule' | 'quantity' | 'text' | 'po' | 'list'

export const FIELD_CLASS: Record<string, FieldClass> = {
  customer_po: 'po',
  so_no: 'identity', hbl_awb_fcr_no: 'identity', mbl: 'identity', booking_no: 'identity', container_no: 'identity',
  warehouse_so: 'identity', // 入仓/订仓号 — display + history; NOT dual-written to so_no; not a strong partition key
  customer_code: 'entity', vendor_code: 'entity', forwarder_name: 'entity', consignee_name: 'entity',
  cargo_ready_date: 'schedule', warehouse_start_date: 'schedule', warehouse_end_date: 'schedule',
  etd: 'schedule', atd: 'schedule', eta: 'schedule', ata: 'schedule', in_dc_date: 'schedule',
  qty: 'quantity',
  // ports of loading / discharge — B/L-authoritative (newest-authoritative doc wins). MUST be listed or
  // mergeShipment drops them on the reconcile-from-evidence path.
  pol: 'text', pod: 'text', consignee_address: 'text',
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
  /** Genuine field-value disagreements (entity codes / equal-rank party names). */
  conflicts: string[]
  /**
   * Merge notes — co-current equal-rank identities, lifecycle supersedes (when surfaced), adjustments.
   * Must NOT inflate "unresolved conflict" scoring (#112 / #117). Optional for callers that ignore it.
   */
  notes: string[]
}

const alnum = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const sameVal = (a: unknown, b: unknown) => alnum(a) === alnum(b)
/** a resolved UN/LOCODE ('GBLHR', 'CNSHK') — 2 country letters + 3 alnum. A pol/pod that is a clean LOCODE
 *  is authoritative; a free-text country blob ('United Kingdom; Belgium') is not, so the LOCODE wins ties. */
const isLocode = (v: unknown): boolean => /^[A-Z]{2}[A-Z0-9]{3}$/.test(alnum(v))
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
  const notes: string[] = []
  const pos = new Set<string>()
  for (const e of sorted) for (const p of e.pos ?? []) if (p) pos.add(p)

  for (const [field, cls] of Object.entries(FIELD_CLASS)) {
    if (cls === 'po') continue
    let stated = sorted
      .filter((e) => present(e.fields[field]))
      .map((e) => ({ value: e.fields[field], emailType: e.emailType, rank: rank(e.emailType) }))

    // a bare ≤3-digit sequence token ('001','002') in an identity slot is a row/line number lifted from a
    // tabular CVP invoice, never a real booking/SO/HBL — drop it so it neither commits nor conflicts.
    if (cls === 'identity') stated = stated.filter((s) => !isSequenceToken(s.value))

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
      // pol/pod: a free-text country blob ('United Kingdom; Belgium') must never beat a clean UN/LOCODE
      // ('GBLHR') on an equal-rank tie — prefer a LOCODE-shaped value when ranks are equal. Higher rank still wins.
      if (field === 'pol' || field === 'pod') {
        for (const c of stated) {
          if (c.rank > kept.rank) kept = c
          else if (c.rank === kept.rank && isLocode(c.value) && !isLocode(kept.value)) kept = c
          else if (c.rank === kept.rank && isLocode(c.value) === isLocode(kept.value)) kept = c // ties → newest
        }
      } else {
        for (const c of stated) if (c.rank >= kept.rank) kept = c // best rank, ties → newest
      }
    } else {
      // identity / entity — keep in sync with cobalt-queue/src/critic/merge.ts (#117):
      //   · identity equal-rank DISTINCT → co-current (note), NOT conflict
      //   · identity different-rank → lifecycle supersede (note), NOT conflict
      //   · entity codes → any distinct = conflict
      //   · entity names → equal-rank clash only = conflict
      const same = cls === 'identity' ? sameId : field === 'forwarder_name' || field === 'consignee_name' ? sameName : sameVal
      for (const c of stated.slice(1)) {
        if (same(c.value, kept.value)) {
          if (alnum(c.value).length > alnum(kept.value).length) kept = c // keep the fuller form
          continue
        }
        const dr = rank(kept.emailType)
        const higher = c.rank > dr
        const isCode = cls === 'entity' && field !== 'forwarder_name' && field !== 'consignee_name'
        // #117: do NOT treat equal-rank identity as conflict (was: isCode || c.rank === dr)
        const isConflict = isCode || (cls === 'entity' && c.rank === dr)
        let oldVal: unknown, oldType: string, newVal: unknown, newType: string
        if (higher) {
          oldVal = kept.value; oldType = kept.emailType; newVal = c.value; newType = c.emailType
          kept = c
        } else {
          oldVal = c.value; oldType = c.emailType; newVal = kept.value; newType = kept.emailType
        }
        if (isConflict) {
          conflicts.push(`${field}: kept '${newVal}' (${newType}) vs '${oldVal}' (${oldType})`)
        } else if (cls === 'identity' && c.rank === dr) {
          // co-current equal-rank identities (queue keeps all in identifiers[]; we note + keep one field value)
          notes.push(
            `${field}: co-current '${oldVal}' (${oldType}) alongside '${newVal}' (${newType}) — multi-id, not a field conflict`,
          )
        } else {
          // lifecycle supersede / lower-rank restatement
          notes.push(`${field}: '${oldVal}' (${oldType}) → '${newVal}' (${newType})`)
        }
      }
    }
    out[field] = kept.value
  }
  return { fields: out, pos: [...pos].sort(), conflicts, notes: [...new Set(notes)] }
}
