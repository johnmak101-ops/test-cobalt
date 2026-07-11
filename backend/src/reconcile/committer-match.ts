/**
 * PURE leg-matching for CommitterService.apply — extracted so the subtle rules stay unit-tested and the
 * per-leg PO lookup is one bulk load. Re-exported from here; committer-match.spec.ts is the suite.
 */
import { keysOverlap, strongKeys, normKey } from './match-keys'

const setsOverlap = (a: Set<string>, b: Set<string>) => {
  for (const x of a) if (b.has(x)) return true
  return false
}

/** BUG 4: two strong-key sets CONFLICT when they state DIFFERENT values for the SAME identity type
 *  (e.g. booking_no:ULLA26060096 on the leg vs booking_no:ULLA26060102 on the group). A conflicting leg
 *  is a different shipment and must never be amended — insert a new leg + route to review instead. Keys
 *  are `type:value`; group by the type prefix and flag any type present on both sides with unequal values. */
export const strongKeysConflict = (a: Set<string>, b: Set<string>): boolean => {
  const byType = (s: Set<string>): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>()
    for (const k of s) {
      const i = k.indexOf(':')
      if (i < 0) continue
      const type = k.slice(0, i)
      const val = k.slice(i + 1)
      if (!m.has(type)) m.set(type, new Set())
      m.get(type)!.add(val)
    }
    return m
  }
  const am = byType(a)
  const bm = byType(b)
  for (const [type, avals] of am) {
    const bvals = bm.get(type)
    if (!bvals) continue // type absent on the other side → no conflict for that type
    // present on both sides: conflict unless they SHARE at least one value for this type
    let shared = false
    for (const v of avals) if (bvals.has(v)) { shared = true; break }
    if (!shared) return true
  }
  return false
}

/**
 * Given candidate legs, a bookingId→[poNumber] map, and the group's keys, return the existing leg this
 * group amends — or undefined (→ new leg). A leg matches when:
 *   - it shares a STRONG key with the group AND is PO-consistent (never when their strong keys CONFLICT); OR
 *   - they share a PO and at least ONE side has no strong id (a nascent PO-only leg gaining its first id).
 * A2 fallback: a zero-identity group (no strong key AND no PO) matches another zero-identity leg of the same
 * thread by the conversationId persisted in match_keys — so a re-ingest UPDATES the provisional row.
 */
export function findExistingLeg<L extends { bookingId: string; matchKeys: unknown }>(
  legs: L[],
  posByBooking: Map<string, string[]>,
  gk: Set<string>,
  groupPos: Set<string>,
  conversationId: string | null,
): L | undefined {
  let existing: L | undefined
  for (const l of legs) {
    const legStrong = strongKeys(l.matchKeys as Record<string, unknown>)
    // BUG 4: a group whose strong key states a DIFFERENT value for a type the leg already carries is a
    // DIFFERENT shipment — never a match here, on ANY path (strong-overlap, PO, or conversationId).
    if (strongKeysConflict(gk, legStrong)) continue
    const bkPos = new Set((posByBooking.get(l.bookingId) ?? []).map((p) => normKey(p)).filter(Boolean))
    const sharePo = groupPos.size > 0 && setsOverlap(groupPos, bkPos)
    if (gk.size > 0 && keysOverlap(legStrong, gk)) {
      if (bkPos.size && !sharePo) continue // strong match but clashing POs → not the same shipment
      existing = l
      break
    }
    if (sharePo && (legStrong.size === 0 || gk.size === 0)) {
      existing = l
      break
    }
  }
  // A2: zero-identity group → match another zero-identity leg of the same thread by conversationId. The
  // leg-strong==0 guard keeps it strictly zero-identity, so conversationId can never bridge two legs.
  if (!existing && gk.size === 0 && groupPos.size === 0 && conversationId) {
    const conv = normKey(conversationId)
    existing = legs.find((l) => {
      const mk = (l.matchKeys ?? {}) as Record<string, unknown>
      const legStrong = strongKeys(mk)
      if (legStrong.size !== 0) return false
      if (strongKeysConflict(gk, legStrong)) return false
      return normKey(mk.conversation_id) === conv
    })
  }
  return existing
}
