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
 *
 * A leg a human FOLDED INTO another (review link() → linked_shipment_id) is never a match target: its
 * content now lives on the successor. It keeps its match_keys (for A2) and its booking keeps the POs
 * (linkProvisionalLeg copies shipment_pos only), so without this guard a follow-up email sharing a PO
 * commits onto the retired husk — invisibly, since it is also dismissed — and the real shipment silently
 * stops updating. Note this is NOT a dismissed-leg guard: a dismissed-but-unlinked leg (portal echo, "not
 * a shipment") MUST still match, or every re-ingest mints a duplicate and the queue refills.
 */
export function findExistingLeg<L extends { bookingId: string; matchKeys: unknown; linkedShipmentId?: string | null }>(
  legs: L[],
  posByBooking: Map<string, string[]>,
  gk: Set<string>,
  groupPos: Set<string>,
  conversationId: string | null,
): L | undefined {
  let existing: L | undefined
  for (const l of legs) {
    if (l.linkedShipmentId != null) continue // folded into another shipment — match its successor, not it
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
      if (l.linkedShipmentId != null) return false // folded away — never re-adopt the husk
      const mk = (l.matchKeys ?? {}) as Record<string, unknown>
      const legStrong = strongKeys(mk)
      if (legStrong.size !== 0) return false
      if (strongKeysConflict(gk, legStrong)) return false
      return normKey(mk.conversation_id) === conv
    })
  }
  return existing
}

/**
 * Thread-gains-its-first-identity adoption: when a KEYED group found no existing leg, a strictly
 * zero-identity leg (no strong key AND no PO) of the SAME conversation is the same nascent shipment
 * finally receiving its booking/SO/HBL — adopt it instead of spawning a duplicate. Mirrors the
 * shared-PO nascent fill-in philosophy; the strictly-zero guard preserves the A2 invariant that a
 * conversationId can never bridge two IDENTIFIED legs. Dismissed/linked husks are never adopted
 * (a human retired them), and any ambiguity (≥2 zero-identity legs in one thread) adopts nothing.
 */
export function findAdoptableZeroIdLeg<
  L extends { bookingId: string; matchKeys: unknown; dismissedAt?: Date | string | null; linkedShipmentId?: string | null },
>(legs: L[], posByBooking: Map<string, string[]>, conversationId: string): L | undefined {
  const conv = normKey(conversationId)
  if (!conv) return undefined
  const adoptable = legs.filter((l) => {
    if (l.dismissedAt != null || l.linkedShipmentId != null) return false
    const mk = (l.matchKeys ?? {}) as Record<string, unknown>
    if (strongKeys(mk).size !== 0) return false
    if ((posByBooking.get(l.bookingId) ?? []).length > 0) return false
    return normKey(mk.conversation_id) === conv
  })
  return adoptable.length === 1 ? adoptable[0] : undefined
}

/** Booking-layer identity types — one booking legitimately spans N legs, so a conflict CONFINED to the
 *  leg layer (hbl) while the booking layer agrees is a SIBLING, not a re-keyed zombie (#151). */
const BOOKING_LAYER = new Set(['booking_no', 'so_no'])

function bookingLayerOnly(keys: Set<string>): Set<string> {
  return new Set([...keys].filter((k) => BOOKING_LAYER.has(k.slice(0, k.indexOf(':')))))
}

/**
 * After committing a keyed group, retire provisional siblings whose BOOKING-LAYER identity CONFLICTS
 * on one type while OVERLAPPING on another — a re-parse corrected one of the shipment's booking-layer
 * ids (the BEFF01 case: old leg so_no=Shipment-REF, new group so_no=order-no, both share booking_no).
 * Conflict + overlap is the signature of the SAME shipment re-keyed; the overlap requirement is
 * load-bearing. Conflict + merely sharing the CONVERSATION must NEVER retire: a consolidated thread
 * legitimately holds several REAL shipments with conflicting ids (BSTI: UK + NL legs, one thread,
 * different SOs; KOHL/YAQI: five HBL legs, one thread) — a conversation branch here dismissed all of
 * them on re-ingest (probe-verified).
 *
 * #151: a conflict CONFINED to the leg layer (different HBLs under one shared booking) is a sibling
 * consolidation — Phase 2 files it as legNo N, never retires it. Retire ONLY when the booking-layer
 * keys themselves conflict AND overlap.
 *
 * Does NOT loosen findExistingLeg / strongKeysConflict itself.
 */
export function findSupersededByIdentityCorrection<L extends {
  id: string
  matchKeys: unknown
  reviewStatus?: string | null
  dismissedAt?: Date | string | null
  linkedShipmentId?: string | null
}>(legs: L[], newGroupKeys: Set<string>, newLegId: string): L[] {
  return legs.filter((l) => {
    if (l.id === newLegId) return false
    if (l.linkedShipmentId != null) return false
    if (l.dismissedAt != null) return false
    // Missing status (index/partial rows) → treat as provisional; present status must be provisional.
    if (l.reviewStatus != null && l.reviewStatus !== 'provisional') return false
    const legStrong = strongKeys((l.matchKeys ?? {}) as Record<string, unknown>)
    // Retire ONLY on a booking-layer re-key (BEFF01: so_no conflicts, booking_no shared).
    const gkBooking = bookingLayerOnly(newGroupKeys)
    const legBooking = bookingLayerOnly(legStrong)
    return strongKeysConflict(gkBooking, legBooking) && keysOverlap(gkBooking, legBooking)
  })
}
