import { mapCriticFieldToColumn, conflictColumns } from './review-fields'

/**
 * The slice of the shipment detail this derivation reads. Structural on purpose — importing
 * ShipmentDetail from hooks/ would point a lib module at the data layer.
 */
export interface PendingReviewSource {
  reviewStatus?: string | null
  reviewReasons?: string[]
  criticReview?: { conflicts?: Array<{ field: string }> } | null
  contestedLocks?: Array<{ field: string }> | null
}

/**
 * Reasons that state a genuine disagreement. reviewReasons also carries system-decision notes
 * ("ETD set to departure date …") whose prose names columns; parsing those would amber-light a
 * field nobody has a question about, so only conflict-flavoured reasons feed conflictColumns.
 */
const CONFLICT_REASON_RE = /conflict|disagree|differ|already stored on|locked field/i

/**
 * Leg columns with something OPEN against them, for the Order Details word-highlight
 * (.review-pending-value): the union of
 *   - critic conflicts while the shipment is still provisional (approving/dismissing the review
 *     item flips reviewStatus, so the highlight clears itself), and
 *   - contested locks, which stay until Keep/Restore regardless of review status.
 * Unknown critic fields are dropped, not invented — same rule as mapCriticFieldsToColumns.
 */
/** Per-column marker for the Order Details rows: 'warn' = open review question (yellow icon),
 *  'miss' = master miss — party/port not in Mesh (red icon, outranks warn). Messages feed the
 *  icon's hover tooltip. */
export type PendingAnnotation = { level: 'warn' | 'miss'; messages: string[] }

const MESH_MISS_RE =
  /did not exact(?:\/curated)?-match a (?:port )?master|not found in Mesh Database|Cannot match "[^"]+" in the (?:forwarder|customer|vendor|consignee) list|not in UN\/LOCODE masters/i

/** Field token a mesh-miss reason starts with ("forwarder_name \"LOGWIN\" did not…") → column. */
function missColumn(reason: string): string | null {
  const token = reason.match(/^([a-z_]+)\s+"/i)?.[1]
  if (token) return mapCriticFieldToColumn(token)
  if (/forwarder/i.test(reason)) return 'forwarderRaw'
  if (/vendor|factory/i.test(reason)) return 'vendorRaw'
  if (/customer/i.test(reason)) return 'customerRaw'
  if (/consignee/i.test(reason)) return 'consigneeName'
  if (/\bpol\b/i.test(reason)) return 'polRaw'
  if (/\bpod\b|port/i.test(reason)) return 'podRaw'
  return null
}

/** Column → annotation for the detail rows (see PendingAnnotation). Same sources as
 *  pendingReviewColumns, plus master misses (criticReview.masterMisses + mesh reasons). */
export function pendingReviewAnnotations(
  shipment:
    | (PendingReviewSource & {
        criticReview?: {
          conflicts?: Array<{ field: string; label?: string; rationale?: string }>
          masterMisses?: Array<{ type: string; rawName: string; field: string }>
        } | null
        contestedLocks?: Array<{ field: string; yourValue?: string | null; newValue?: string | null }> | null
      })
    | null
    | undefined,
): Map<string, PendingAnnotation> {
  const out = new Map<string, PendingAnnotation>()
  if (!shipment) return out
  const add = (col: string | null, level: 'warn' | 'miss', msg: string) => {
    if (!col) return
    const cur = out.get(col)
    if (!cur) out.set(col, { level, messages: [msg] })
    else {
      if (!cur.messages.includes(msg)) cur.messages.push(msg)
      if (level === 'miss') cur.level = 'miss'
    }
  }
  if (shipment.reviewStatus === 'provisional') {
    for (const c of shipment.criticReview?.conflicts ?? []) {
      add(
        mapCriticFieldToColumn(c.field),
        'warn',
        c.rationale?.trim() || 'Values disagree across emails — resolve in the review queue.',
      )
    }
    for (const r of shipment.reviewReasons ?? []) {
      if (MESH_MISS_RE.test(r)) add(missColumn(r), 'miss', r)
      else if (CONFLICT_REASON_RE.test(r)) for (const col of conflictColumns([r])) add(col, 'warn', r)
    }
    for (const m of shipment.criticReview?.masterMisses ?? []) {
      add(
        mapCriticFieldToColumn(m.field) ?? missColumn(m.field + ' "x"'),
        'miss',
        `"${m.rawName}" not found in Mesh Database — advise add in Mesh.`,
      )
    }
  }
  for (const lock of shipment.contestedLocks ?? []) {
    add(
      mapCriticFieldToColumn(lock.field) ?? lock.field,
      'warn',
      `A newer email changed your edit (${lock.yourValue ?? '—'} → ${lock.newValue ?? '—'}) — keep or restore below.`,
    )
  }
  return out
}

export function pendingReviewColumns(
  shipment: PendingReviewSource | null | undefined,
): Set<string> {
  const cols = new Set<string>()
  if (!shipment) return cols
  if (shipment.reviewStatus === 'provisional') {
    for (const c of shipment.criticReview?.conflicts ?? []) {
      const col = mapCriticFieldToColumn(c.field)
      if (col) cols.add(col)
    }
    const conflictReasons = (shipment.reviewReasons ?? []).filter((r) =>
      CONFLICT_REASON_RE.test(r),
    )
    for (const col of conflictColumns(conflictReasons)) cols.add(col)
  }
  for (const lock of shipment.contestedLocks ?? []) {
    cols.add(mapCriticFieldToColumn(lock.field) ?? lock.field)
  }
  return cols
}
