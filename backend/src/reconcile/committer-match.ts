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
 * Do the two strong-key sets agree on a BILL-OF-LADING level identifier?
 *
 * `hbl_awb_fcr_no` and `mbl` name one physical shipment/document. `so_no`, `booking_no` and
 * `container_no` are weaker: they are restated, reused across consignments, and (for containers)
 * genuinely shared by different shipments — so only the B/L pair earns the right to overrule a
 * PO-set difference.
 */
const BILL_OF_LADING_KEYS = ['hbl_awb_fcr_no', 'mbl'] as const

function sharesBillOfLadingKey(a: Set<string>, b: Set<string>): boolean {
  for (const k of a) {
    if (!b.has(k)) continue
    const type = k.slice(0, k.indexOf(':'))
    if ((BILL_OF_LADING_KEYS as readonly string[]).includes(type)) return true
  }
  return false
}

/**
 * Given candidate legs, a bookingId→[poNumber] map, and the group's keys, return the existing leg this
 * group amends — or undefined (→ new leg). A leg matches when:
 *   - it shares a STRONG key with the group AND is PO-consistent (never when their strong keys CONFLICT) —
 *     except that a shared B/L identifier (hbl_awb_fcr_no / mbl) matches even when the PO sets differ,
 *     since one B/L legitimately carries many POs and each email cites only the ones it is about; OR
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
      // A shared BILL-OF-LADING identifier settles it: an HBL/AWB/FCR or MBL names ONE physical
      // shipment, and its POs are its CONTENTS — two emails about the same B/L routinely cite
      // different subsets of them. Letting a non-overlapping PO set veto that match is what split
      // one consignment into two legs (FCR001340862: same HBL + same SO, POs differed → leg 17) and
      // even minted a second BOOKING for one B/L (SZXRTM26070080: same HBL + MBL + SO, POs differed).
      // For weaker overlaps (so_no / booking_no / container_no alone) the PO clash still vetoes:
      // those identifiers get reused and restated across shipments far more freely than a B/L number.
      if (bkPos.size && !sharePo && !sharesBillOfLadingKey(legStrong, gk)) continue
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

/** Leg-layer identity: the hbl/awb/fcr — one per real ship (#151). */
function legLayerOnly(keys: Set<string>): Set<string> {
  return new Set([...keys].filter((k) => k.startsWith('hbl_awb_fcr_no:')))
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
/** A leg the committer may act on automatically — not this one, not already retired, still provisional. */
type GhostCandidate = {
  id: string
  matchKeys: unknown
  reviewStatus?: string | null
  dismissedAt?: Date | string | null
  linkedShipmentId?: string | null
  createdManually?: boolean | null
}

/**
 * The re-key predicate itself, shared by the two callers below. Whether a matching leg is RETIRED or
 * merely REPORTED turns on one thing — who made it — and that decision is deliberately outside this
 * function so the identity reasoning stays in one place.
 */
function isIdentityCorrectionGhost(l: GhostCandidate, newGroupKeys: Set<string>, newLegId: string): boolean {
  if (l.id === newLegId) return false
  if (l.linkedShipmentId != null) return false
  if (l.dismissedAt != null) return false
  // Missing status (index/partial rows) → treat as provisional; present status must be provisional.
  if (l.reviewStatus != null && l.reviewStatus !== 'provisional') return false
  const legStrong = strongKeys((l.matchKeys ?? {}) as Record<string, unknown>)
  // A leg carrying its OWN distinct leg-layer id is a REAL SHIP — a sibling, never a zombie, whatever
  // the booking layer says. Two ships under one booking may each carry their own SO (BSTI: NL 29954607
  // / UK 29954612), which a booking-layer-only rule read as a re-key and retired — while
  // findSiblingBooking simultaneously claimed the same leg as a sibling to attach, so one apply()
  // would file legNo 2 AND dismiss the other ship. The BEFF01 ghost has NO hbl: nothing marks it as a
  // separate ship, which is exactly what makes it a re-key of this one.
  const legHbl = legLayerOnly(legStrong)
  if (legHbl.size && !keysOverlap(legHbl, legLayerOnly(newGroupKeys))) return false
  // Retire ONLY on a booking-layer re-key (BEFF01: so_no conflicts, booking_no shared).
  const gkBooking = bookingLayerOnly(newGroupKeys)
  const legBooking = bookingLayerOnly(legStrong)
  return strongKeysConflict(gkBooking, legBooking) && keysOverlap(gkBooking, legBooking)
}

export function findSupersededByIdentityCorrection<L extends GhostCandidate>(
  legs: L[],
  newGroupKeys: Set<string>,
  newLegId: string,
): L[] {
  // 0028: a HAND-TYPED leg is never a re-parse ghost. The predicate below reads "the same shipment,
  // re-keyed" — true when the agent corrected ITS OWN earlier reading, which is the case it was built
  // for. A person's leg is a different claim: they typed the number they held, and a conflict with a
  // later email means the two disagree, not that the human's row was a draft. Retiring it here also
  // dropped their field LOCKS (locks are per shipment id and nothing carries them to the successor),
  // so a value the operator deliberately protected quietly stopped being protected. Reported instead —
  // see findManualIdentityClash.
  return legs.filter((l) => isIdentityCorrectionGhost(l, newGroupKeys, newLegId) && l.createdManually !== true)
}

/**
 * The legs `findSupersededByIdentityCorrection` just DECLINED to retire because a person made them.
 *
 * Same predicate, opposite side of the human/agent split. The situation is real either way — two legs
 * state conflicting booking-layer ids while sharing another — so it has to reach someone; it simply
 * must not be settled by dismissing the human's row. The committer turns each of these into a review
 * reason on the new leg, which is where an operator can compare the two and fold one into the other.
 */
export function findManualIdentityClash<L extends GhostCandidate>(
  legs: L[],
  newGroupKeys: Set<string>,
  newLegId: string,
): L[] {
  return legs.filter((l) => isIdentityCorrectionGhost(l, newGroupKeys, newLegId) && l.createdManually === true)
}

/**
 * A leg that shares a PO with this group, states no CONFLICTING identity, and simply carries a
 * DIFFERENT one — the duplicate `findExistingLeg` cannot rule out and must not silently merge.
 *
 * The shared-PO branch of `findExistingLeg` needs one side to have no strong id at all, because a PO
 * legitimately ships across several shipments: matching on it alone would fuse two real consignments.
 * That leaves a blind spot exactly where a leg's identity is knowingly PARTIAL — a hand-typed leg. The
 * operator creates one because the booking email was never ingested, entering the single number they
 * hold; when the forwarder's later mail cites its HBL and the same PO but not that number, nothing
 * connects them and a second leg appears beside the first with no hint the two are related.
 *
 * Deliberately NOT a match: whether they are one shipment is a judgement about the physical cargo, and
 * the evidence here (one shared PO, two different ids, no contradiction) genuinely supports both
 * readings. So this returns candidates to REPORT, and the operator folds them with the review desk's
 * existing link action if they agree.
 *
 * Bounded to human-created legs on one side or the other (`groupIsManual` covers a manual create
 * landing beside an existing agent leg). Agent-vs-agent pairs sharing a PO are the ordinary case —
 * flagging those would put most of the queue under a duplicate warning and teach operators to ignore
 * it. A `strongKeysConflict` pair is excluded too: stating DIFFERENT values for the SAME id type is
 * positive evidence of two shipments, and the re-key path above already owns that case.
 */
export function findPoOnlyDuplicateRisk<
  L extends {
    id: string
    bookingId: string
    matchKeys: unknown
    dismissedAt?: Date | string | null
    linkedShipmentId?: string | null
    createdManually?: boolean | null
  },
>(
  legs: L[],
  posByBooking: Map<string, string[]>,
  gk: Set<string>,
  groupPos: Set<string>,
  groupIsManual: boolean,
  committedLegId: string,
): L[] {
  // gk empty → the shared-PO branch already matched (or the group has no identity at all); nothing at risk.
  if (gk.size === 0 || groupPos.size === 0) return []
  return legs.filter((l) => {
    if (l.id === committedLegId) return false // the leg this commit just wrote
    if (l.linkedShipmentId != null) return false // folded into another shipment
    if (l.dismissedAt != null) return false // a human already retired it
    if (!groupIsManual && l.createdManually !== true) return false // agent↔agent PO sharing is normal
    const legStrong = strongKeys(l.matchKeys as Record<string, unknown>)
    if (legStrong.size === 0) return false // findExistingLeg's PO branch already reaches it
    if (keysOverlap(legStrong, gk)) return false // matched on a strong key — not a duplicate risk
    if (strongKeysConflict(gk, legStrong)) return false // different values, same type → different shipments
    const bkPos = new Set((posByBooking.get(l.bookingId) ?? []).map((p) => normKey(p)).filter(Boolean))
    return setsOverlap(groupPos, bkPos)
  })
}

/**
 * #151 Phase 2: the group shares a BOOKING-LAYER value (booking_no / so_no) with existing leg(s) but
 * carries its OWN leg-layer id (hbl) — that is a sibling ship of the same booking, not a new booking
 * and not (per Task 2.0) a zombie. Returns the bookingId to attach a new legNo under, or undefined.
 * Conservative: the group must have exactly its own DISTINCT hbl; all matching candidates must agree on
 * ONE bookingId; linked husks excluded. findExistingLeg / strongKeysConflict are untouched — this runs
 * only after findExistingLeg found no match.
 */
export function findSiblingBooking<
  L extends { bookingId: string; matchKeys: unknown; linkedShipmentId?: string | null },
>(legs: L[], gk: Set<string>): string | undefined {
  const gkBooking = new Set([...gk].filter((k) => k.startsWith('booking_no:') || k.startsWith('so_no:')))
  const gkHbl = new Set([...gk].filter((k) => k.startsWith('hbl_awb_fcr_no:')))
  if (!gkBooking.size || gkHbl.size !== 1) return undefined
  const bookingIds = new Set<string>()
  for (const l of legs) {
    if (l.linkedShipmentId != null) continue
    const legStrong = strongKeys(l.matchKeys as Record<string, unknown>)
    const legBooking = new Set([...legStrong].filter((k) => k.startsWith('booking_no:') || k.startsWith('so_no:')))
    const legHbl = new Set([...legStrong].filter((k) => k.startsWith('hbl_awb_fcr_no:')))
    if (!keysOverlap(gkBooking, legBooking)) continue // must SHARE a booking-layer value
    if (legHbl.size && keysOverlap(gkHbl, legHbl)) continue // same hbl = findExistingLeg's territory
    bookingIds.add(l.bookingId)
  }
  return bookingIds.size === 1 ? [...bookingIds][0] : undefined
}
