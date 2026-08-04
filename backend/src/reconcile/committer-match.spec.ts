import { describe, it, expect } from 'vitest'
import {
  findExistingLeg,
  findPoOnlyAmbiguity,
  findAdoptableZeroIdLeg,
  findSupersededByIdentityCorrection,
  findManualIdentityClash,
  findPoOnlyDuplicateRisk,
  findSiblingBooking,
} from './committer-match'
import { strongKeys, normKey } from './match-keys'

type Leg = { id: string; bookingId: string; matchKeys: Record<string, unknown> }
const leg = (id: string, bookingId: string, matchKeys: Record<string, unknown>): Leg => ({ id, bookingId, matchKeys })
const gkOf = (mk: Record<string, unknown>) => strongKeys(mk)
const posSet = (...pos: string[]) => new Set(pos.map(normKey).filter(Boolean))

describe('findExistingLeg — a leg folded into another is never the match target', () => {
  // review.link() retires the source: linked_shipment_id + dismissed_at set, match_keys KEPT (A2), and its
  // booking still holds the POs (linkProvisionalLeg copies shipment_pos only). Without the linked-husk
  // guard, a follow-up email sharing a PO commits onto the retired husk — invisibly, since it is dismissed —
  // and the real shipment silently stops updating. candidateLegs has no ORDER BY, so the winner was
  // decided by arbitrary row order.
  const husk = { id: 'SRC', bookingId: 'B_SRC', matchKeys: { conversation_id: 'CONV-1' }, dismissedAt: new Date(), linkedShipmentId: 'TARGET' }
  const target = { id: 'TARGET', bookingId: 'B_TGT', matchKeys: { booking_no: 'BX1' } }
  const posByBooking = new Map([['B_SRC', ['P1', 'P2']], ['B_TGT', ['P1']]])

  it('skips the linked husk regardless of candidate order', () => {
    const gk = gkOf({ booking_no: 'BX1' })
    const pos = posSet('P1')
    expect(findExistingLeg([husk, target], posByBooking, gk, pos, 'CONV-1')?.id).toBe('TARGET')
    expect(findExistingLeg([target, husk], posByBooking, gk, pos, 'CONV-1')?.id).toBe('TARGET')
  })

  it('a PO-only follow-up does not resurrect the husk — it creates a new leg instead', () => {
    // no strong key on the email, only the shared PO: the husk must not absorb it
    expect(findExistingLeg([husk], posByBooking, new Set(), posSet('P2'), 'CONV-1')).toBeUndefined()
  })

  it('a DISMISSED-but-not-linked leg still matches (dismissal is sticky by design — no duplicate on re-ingest)', () => {
    const dismissedEcho = { id: 'ECHO', bookingId: 'B_E', matchKeys: { booking_no: 'BX9' }, dismissedAt: new Date(), linkedShipmentId: null }
    expect(findExistingLeg([dismissedEcho], new Map(), gkOf({ booking_no: 'BX9' }), new Set(), null)?.id).toBe('ECHO')
  })

  it('the A2 conversation fallback also refuses the husk (a keyless re-ingest must not re-adopt it)', () => {
    // zero-identity group, same thread: the husk is the only conversation match — must NOT be returned
    expect(findExistingLeg([husk], new Map(), new Set(), new Set(), 'CONV-1')).toBeUndefined()
  })
})

describe('findExistingLeg (committer leg-matching, pure + N+1-free)', () => {
  it('matches a leg that shares a strong key', () => {
    const legs = [leg('L1', 'B1', { booking_no: 'BX845666' })]
    const r = findExistingLeg(legs, new Map(), gkOf({ booking_no: 'BX845666' }), new Set(), null)
    expect(r?.id).toBe('L1')
  })

  it('does NOT match when strong keys CONFLICT (same type, different value)', () => {
    const legs = [leg('L1', 'B1', { booking_no: 'BX845666' })]
    const r = findExistingLeg(legs, new Map(), gkOf({ booking_no: 'BX999999' }), new Set(), null)
    expect(r).toBeUndefined()
  })

  it('treats a booking revision suffix as the SAME booking (normBookingKey)', () => {
    const legs = [leg('L1', 'B1', { booking_no: 'BX845666' })]
    const r = findExistingLeg(legs, new Map(), gkOf({ booking_no: 'BX845666 REV2' }), new Set(), null)
    expect(r?.id).toBe('L1')
  })

  it('matches a nascent PO-only leg (leg has no strong id, group shares a PO)', () => {
    const legs = [leg('L1', 'B1', {})]
    const posByBooking = new Map([['B1', ['PO-123']]])
    const r = findExistingLeg(legs, posByBooking, new Set(), posSet('PO123'), null)
    expect(r?.id).toBe('L1')
  })

  it('does NOT match on strong overlap when the POs clash (different shipment)', () => {
    const legs = [leg('L1', 'B1', { booking_no: 'BX845666' })]
    const posByBooking = new Map([['B1', ['PO-999']]])
    const r = findExistingLeg(legs, posByBooking, gkOf({ booking_no: 'BX845666' }), posSet('PO123'), null)
    expect(r).toBeUndefined()
  })

  /**
   * A B/L identifier names ONE physical shipment and legitimately carries MANY POs — each email cites
   * only the ones it is about. Letting a non-overlapping PO set veto that match split real consignments:
   * both cases below are reproduced from production data (24 Jul 2026).
   */
  describe('a shared B/L identifier outranks a PO-set difference', () => {
    it('same HBL + SO, different PO — one leg, not two (real: FCR001340862 spawned leg 17)', () => {
      const legs = [leg('L1', 'B1', { hbl_awb_fcr_no: 'FCR001340862', so_no: 'S13747714', booking_no: 'SBK0003905231' })]
      const posByBooking = new Map([['B1', ['Z13789071']]])
      const r = findExistingLeg(
        legs,
        posByBooking,
        gkOf({ hbl_awb_fcr_no: 'FCR001340862', so_no: 'S13747714' }),
        posSet('C13769406'),
        null,
      )
      expect(r?.id).toBe('L1')
    })

    it('same HBL + MBL + SO, different PO — one booking, not two (real: SZXRTM26070080)', () => {
      const legs = [
        leg('L1', 'B1', {
          hbl_awb_fcr_no: 'SZXRTM26070080',
          mbl: 'OOLU8882464820',
          so_no: 'CCA/SZ/RTM-15449',
          booking_no: 'B003352',
        }),
      ]
      const posByBooking = new Map([['B1', ['23402']]])
      const r = findExistingLeg(
        legs,
        posByBooking,
        gkOf({ hbl_awb_fcr_no: 'SZXRTM26070080', mbl: 'OOLU8882464820', so_no: 'CCA/SZ/RTM-15449' }),
        posSet('23817_1610-363'),
        null,
      )
      expect(r?.id).toBe('L1')
    })

    it('MBL alone also outranks a PO difference', () => {
      const legs = [leg('L1', 'B1', { mbl: 'MAEU271373171' })]
      const posByBooking = new Map([['B1', ['PO-999']]])
      const r = findExistingLeg(legs, posByBooking, gkOf({ mbl: 'MAEU271373171' }), posSet('PO123'), null)
      expect(r?.id).toBe('L1')
    })

    it('but a CONFLICTING B/L still never matches — the exemption is for PO differences only', () => {
      const legs = [leg('L1', 'B1', { hbl_awb_fcr_no: 'FCR001340862' })]
      const posByBooking = new Map([['B1', ['PO-999']]])
      const r = findExistingLeg(legs, posByBooking, gkOf({ hbl_awb_fcr_no: 'FCR009999999' }), posSet('PO123'), null)
      expect(r).toBeUndefined()
    })

    it('and so_no / container_no alone do NOT earn the exemption (weaker, reused identifiers)', () => {
      const soLegs = [leg('L1', 'B1', { so_no: 'S13747714' })]
      const posByBooking = new Map([['B1', ['PO-999']]])
      expect(findExistingLeg(soLegs, posByBooking, gkOf({ so_no: 'S13747714' }), posSet('PO123'), null)).toBeUndefined()

      const ctrLegs = [leg('L2', 'B2', { container_no: 'MRKU1234567' })]
      const ctrPos = new Map([['B2', ['PO-999']]])
      expect(findExistingLeg(ctrLegs, ctrPos, gkOf({ container_no: 'MRKU1234567' }), posSet('PO123'), null)).toBeUndefined()
    })
  })

  it('A2: a zero-identity group matches a zero-identity leg of the same thread by conversationId', () => {
    const legs = [leg('L1', 'B1', { conversation_id: 'CONV-1' })]
    const r = findExistingLeg(legs, new Map(), new Set(), new Set(), 'CONV-1')
    expect(r?.id).toBe('L1')
  })

  it('A2 never bridges a leg that carries a strong id', () => {
    const legs = [leg('L1', 'B1', { booking_no: 'BX1', conversation_id: 'CONV-1' })]
    const r = findExistingLeg(legs, new Map(), new Set(), new Set(), 'CONV-1')
    expect(r).toBeUndefined()
  })

  it('returns undefined when nothing matches → caller creates a new leg', () => {
    const legs = [leg('L1', 'B1', { booking_no: 'BX1' })]
    const r = findExistingLeg(legs, new Map(), gkOf({ so_no: 'SO-ZZZ' }), new Set(), null)
    expect(r).toBeUndefined()
  })
})

type AdoptLeg = Leg & { dismissedAt?: Date | null; linkedShipmentId?: string | null }
const aleg = (id: string, bookingId: string, matchKeys: Record<string, unknown>, over: Partial<AdoptLeg> = {}): AdoptLeg =>
  ({ id, bookingId, matchKeys, dismissedAt: null, linkedShipmentId: null, ...over })

describe('🔴 findExistingLeg RANK — candidate order must never decide (the operator lifecycle probe)', () => {
  // The measured coin flip: operator dismisses a thin PO-shell ("not a shipment"), hand-types the real
  // shipment, and the forwarder's next email — naming the manual leg's EXACT booking+SO — landed on
  // whichever row the unordered SQL returned first. Half the time that was the dismissed husk, which
  // absorbed the data invisibly (it stays dismissed; no warning fires; the manual leg never updates).
  const husk = { id: 'HUSK', bookingId: 'B_H', matchKeys: {}, dismissedAt: new Date() }
  const manual = { id: 'MANUAL', bookingId: 'B_M', matchKeys: { booking_no: 'BK-1', so_no: 'SO-1' } }
  const posByBooking = new Map([['B_H', ['PO-X']], ['B_M', ['PO-X']]])

  it('identity outranks shared PO: the keyed email lands on the manual leg in BOTH orders', () => {
    const gk = gkOf({ booking_no: 'BK-1', so_no: 'SO-1' })
    expect(findExistingLeg([husk, manual], posByBooking, gk, posSet('PO-X'), null)?.id).toBe('MANUAL')
    expect(findExistingLeg([manual, husk], posByBooking, gk, posSet('PO-X'), null)?.id).toBe('MANUAL')
  })

  it('live outranks dismissed: the PO-only follow-up lands on the manual leg in BOTH orders', () => {
    expect(findExistingLeg([husk, manual], posByBooking, new Set(), posSet('PO-X'), null)?.id).toBe('MANUAL')
    expect(findExistingLeg([manual, husk], posByBooking, new Set(), posSet('PO-X'), null)?.id).toBe('MANUAL')
  })

  it('a SINGLE dismissed husk with no live alternative still matches (#146 re-ingest, unchanged)', () => {
    expect(findExistingLeg([husk], posByBooking, new Set(), posSet('PO-X'), null)?.id).toBe('HUSK')
  })

  it('two dismissed husks and nothing live = the same guess twice — match neither', () => {
    const husk2 = { id: 'HUSK2', bookingId: 'B_H2', matchKeys: {}, dismissedAt: new Date() }
    const pos = new Map([...posByBooking, ['B_H2', ['PO-X']]])
    expect(findExistingLeg([husk, husk2], pos, new Set(), posSet('PO-X'), null)).toBeUndefined()
  })

  it('🔴 a KEYED group never resurrects a keyless dismissed husk — the manual create mints a LIVE leg', () => {
    // The operator dismissed the thin PO shell, then hand-typed the real shipment (booking+SO+PO).
    // The old PO branch matched their create onto the husk they had JUST retired — resurrected it
    // invisibly (still dismissed) and their "new" shipment never appeared in the tracker.
    const gk = gkOf({ booking_no: 'BK-1', so_no: 'SO-1' })
    expect(findExistingLeg([husk], posByBooking, gk, posSet('PO-X'), null)).toBeUndefined()
  })
})

describe('🔴 findExistingLeg — the split-PO shape (one PO, two live shipments)', () => {
  const legAC = { id: 'AC', bookingId: 'B_C', matchKeys: { booking_no: 'BK-C' } }
  const legAB = { id: 'AB', bookingId: 'B_B', matchKeys: { booking_no: 'BK-B' } }
  const posByBooking = new Map([['B_C', ['PO-X']], ['B_B', ['PO-X']]])

  it('an email citing one booking lands on that leg — the conflict guard keeps it off the other', () => {
    const gk = gkOf({ booking_no: 'BK-C' })
    expect(findExistingLeg([legAC, legAB], posByBooking, gk, posSet('PO-X'), null)?.id).toBe('AC')
    expect(findExistingLeg([legAB, legAC], posByBooking, gk, posSet('PO-X'), null)?.id).toBe('AC')
  })

  it('a PO-ONLY email matches NEITHER — genuine ambiguity, in BOTH orders (was a measured coin flip)', () => {
    expect(findExistingLeg([legAC, legAB], posByBooking, new Set(), posSet('PO-X'), 'conv-new')).toBeUndefined()
    expect(findExistingLeg([legAB, legAC], posByBooking, new Set(), posSet('PO-X'), 'conv-new')).toBeUndefined()
  })

  it('…except its OWN thread-leg: a re-POST / rebuild replay lands back on the leg it minted', () => {
    const own = { id: 'OWN', bookingId: 'B_O', matchKeys: { conversation_id: 'conv-p' } }
    const pos = new Map([...posByBooking, ['B_O', ['PO-X']]])
    expect(findExistingLeg([legAC, own, legAB], pos, new Set(), posSet('PO-X'), 'conv-p')?.id).toBe('OWN')
  })

  it('…and when the desk FOLDED that own leg, the replay follows its link to the successor', () => {
    const own = { id: 'OWN', bookingId: 'B_O', matchKeys: { conversation_id: 'conv-p' }, linkedShipmentId: 'AC', dismissedAt: new Date() }
    const pos = new Map([...posByBooking, ['B_O', ['PO-X']]])
    expect(findExistingLeg([legAC, own, legAB], pos, new Set(), posSet('PO-X'), 'conv-p')?.id).toBe('AC')
  })

  it('a KEYED group still absorbs the first nascent PO shell (the pinned GZL behaviour, unchanged)', () => {
    const shellA = { id: 'SH_A', bookingId: 'B_SA', matchKeys: {} }
    const shellB = { id: 'SH_B', bookingId: 'B_SB', matchKeys: {} }
    const pos = new Map([['B_SA', ['PO-1']], ['B_SB', ['PO-2']]])
    const r = findExistingLeg([shellA, shellB], pos, gkOf({ hbl_awb_fcr_no: 'GZL1' }), posSet('PO-1', 'PO-2'), null)
    expect(r?.id).toBe('SH_A')
  })

  it('findPoOnlyAmbiguity names the two live candidates — and excludes husks, folds, and the own leg', () => {
    const own = { id: 'OWN', bookingId: 'B_O', matchKeys: { conversation_id: 'conv-p' } }
    const husk = { id: 'HUSK', bookingId: 'B_H', matchKeys: {}, dismissedAt: new Date() }
    const pos = new Map([...posByBooking, ['B_O', ['PO-X']], ['B_H', ['PO-X']]])
    const named = findPoOnlyAmbiguity([legAC, legAB, own, husk], pos, new Set(), posSet('PO-X'), 'conv-p')
    expect(named.map((l) => l.id).sort()).toEqual(['AB', 'AC'])
    // one candidate is not an ambiguity
    expect(findPoOnlyAmbiguity([legAC], posByBooking, new Set(), posSet('PO-X'), null)).toEqual([])
    // a keyed group never reports it — pass 1 owns that world
    expect(findPoOnlyAmbiguity([legAC, legAB], posByBooking, gkOf({ booking_no: 'BK-C' }), posSet('PO-X'), null)).toEqual([])
  })
})

describe('findAdoptableZeroIdLeg (thread gains its first identity → adopt, never duplicate)', () => {
  it('adopts the single zero-identity leg of the same thread', () => {
    const legs = [aleg('L1', 'B1', { conversation_id: 'CONV-1' })]
    const r = findAdoptableZeroIdLeg(legs, new Map(), 'CONV-1')
    expect(r?.id).toBe('L1')
  })

  it('never adopts a leg that already carries a strong id', () => {
    const legs = [aleg('L1', 'B1', { booking_no: 'BX1', conversation_id: 'CONV-1' })]
    expect(findAdoptableZeroIdLeg(legs, new Map(), 'CONV-1')).toBeUndefined()
  })

  it('never adopts a leg whose booking carries POs (that is the shared-PO path, not this one)', () => {
    const legs = [aleg('L1', 'B1', { conversation_id: 'CONV-1' })]
    const posByBooking = new Map([['B1', ['PO-123']]])
    expect(findAdoptableZeroIdLeg(legs, posByBooking, 'CONV-1')).toBeUndefined()
  })

  it('never adopts across threads', () => {
    const legs = [aleg('L1', 'B1', { conversation_id: 'CONV-OTHER' })]
    expect(findAdoptableZeroIdLeg(legs, new Map(), 'CONV-1')).toBeUndefined()
  })

  it('never adopts a dismissed or already-linked leg', () => {
    const dismissed = [aleg('L1', 'B1', { conversation_id: 'CONV-1' }, { dismissedAt: new Date() })]
    const linked = [aleg('L2', 'B2', { conversation_id: 'CONV-1' }, { linkedShipmentId: 'X' })]
    expect(findAdoptableZeroIdLeg(dismissed, new Map(), 'CONV-1')).toBeUndefined()
    expect(findAdoptableZeroIdLeg(linked, new Map(), 'CONV-1')).toBeUndefined()
  })

  it('ambiguity (two zero-identity legs in one thread) → adopt NOTHING', () => {
    const legs = [
      aleg('L1', 'B1', { conversation_id: 'CONV-1' }),
      aleg('L2', 'B2', { conversation_id: 'CONV-1' }),
    ]
    expect(findAdoptableZeroIdLeg(legs, new Map(), 'CONV-1')).toBeUndefined()
  })
})

type SuperLeg = {
  id: string
  matchKeys: Record<string, unknown>
  reviewStatus?: string | null
  dismissedAt?: Date | string | null
  linkedShipmentId?: string | null
}
const sleg = (
  id: string,
  matchKeys: Record<string, unknown>,
  over: Partial<SuperLeg> = {},
): SuperLeg => ({ id, matchKeys, reviewStatus: 'provisional', dismissedAt: null, linkedShipmentId: null, ...over })

describe('findSupersededByIdentityCorrection (#146 re-parse zombies) — conflict + OVERLAP required', () => {
  it('shares booking + conflicting so → superseded (the BEFF01 ghost)', () => {
    const zombie = sleg('OLD', { booking_no: 'BX1', so_no: 'SO-OLD', conversation_id: 'CONV-1' })
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    const r = findSupersededByIdentityCorrection([zombie], newKeys, 'NEW')
    expect(r.map((x) => x.id)).toEqual(['OLD'])
  })

  it('different conversation + no shared key → not superseded', () => {
    const other = sleg('OTHER', { booking_no: 'BX-OTHER', so_no: 'SO-OTHER', conversation_id: 'CONV-OTHER' })
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    expect(findSupersededByIdentityCorrection([other], newKeys, 'NEW')).toEqual([])
  })

  it('already dismissed → not superseded', () => {
    const dismissed = sleg('D', { booking_no: 'BX1', so_no: 'SO-OLD' }, { dismissedAt: new Date() })
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    expect(findSupersededByIdentityCorrection([dismissed], newKeys, 'NEW')).toEqual([])
  })

  it('confirmed leg → not superseded', () => {
    const confirmed = sleg('C', { booking_no: 'BX1', so_no: 'SO-OLD' }, { reviewStatus: 'confirmed' })
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    expect(findSupersededByIdentityCorrection([confirmed], newKeys, 'NEW')).toEqual([])
  })

  it('new leg itself → not superseded', () => {
    const self = sleg('NEW', { booking_no: 'BX1', so_no: 'SO-NEW' })
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    // no strongKeysConflict with itself either, but id guard is the primary exclusion
    expect(findSupersededByIdentityCorrection([self], newKeys, 'NEW')).toEqual([])
  })

  // ⚠️ FLIPPED from the original PR: conversation co-residence must NEVER retire. A consolidated
  // thread legitimately holds several REAL shipments with conflicting ids — the conversation branch
  // dismissed all of them on re-ingest (probe-verified on live BSTI + KOHL/YAQI data below).
  it('same conversation alone + conflicting strong id (NO shared key) → NOT superseded', () => {
    const realSibling = sleg('SIBLING', { booking_no: 'BX-OLD', conversation_id: 'CONV-1' })
    const newKeys = gkOf({ booking_no: 'BX-NEW' })
    expect(findSupersededByIdentityCorrection([realSibling], newKeys, 'NEW')).toEqual([])
  })

  it('BSTI regression: committing the NL group retires the ghost but NOT the real UK sibling in the same thread', () => {
    // real data: NL group {booking B1368248010, so 29954607}; UK leg {so 29954612} same conversation;
    // ghost {booking B1368248010, so BEFF01-001627} (Shipment REF mis-parsed into so_no)
    const ukLeg = sleg('UK', { so_no: '29954612', conversation_id: 'CONV-BSTI' })
    const ghost = sleg('GHOST', { booking_no: 'B1368248010', so_no: 'BEFF01-001627', conversation_id: 'CONV-BSTI' })
    const nlKeys = gkOf({ booking_no: 'B1368248010', so_no: '29954607' })
    const r = findSupersededByIdentityCorrection([ukLeg, ghost], nlKeys, 'NL-NEW')
    expect(r.map((x) => x.id)).toEqual(['GHOST'])
  })

  it('KOHL/YAQI regression: committing one HBL doc retires NONE of the sibling HBL legs of the thread', () => {
    const siblings = ['SE26061400001', 'SE26061400005', 'SE26061400006', 'SE26061400002'].map((hbl, i) =>
      sleg(`LEG-${hbl}`, { hbl_awb_fcr_no: hbl, mbl: `ONEYDACG1337${i}900`, conversation_id: 'CONV-KY' }),
    )
    const docAKeys = gkOf({ hbl_awb_fcr_no: 'SE26061400003', mbl: 'ONEYDACG13378900', container_no: 'ONEU0429500' })
    expect(findSupersededByIdentityCorrection(siblings, docAKeys, 'LEG-A')).toEqual([])
  })

  it('a SIBLING leg (booking-layer agrees, only hbl differs) is NEVER retired — that is a consolidation, not a zombie (#151)', () => {
    // post-#151 world: one booking, two legs, each with its own HBL
    const legA = sleg('LEG-A', { booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-NL', conversation_id: 'C1' })
    const groupB = gkOf({ booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-UK' })
    expect(findSupersededByIdentityCorrection([legA], groupB, 'LEG-B')).toEqual([])
  })

  // Two ships under one booking may EACH carry their own SO (BSTI: NL=29954607, UK=29954612). A
  // booking-layer-only rule retired the sibling — and contradicted findSiblingBooking, which claimed the
  // same leg as a sibling to attach: one apply() would file legNo 2 AND dismiss the other ship.
  // What makes a leg a real ship is its OWN leg-layer id; the BEFF01 ghost has no hbl at all.
  it('a SIBLING with its OWN so_no AND its own hbl is NEVER retired (#151)', () => {
    const ukSibling = sleg('LEG-UK', { booking_no: 'B1368248010', so_no: '29954612', hbl_awb_fcr_no: 'HBL-UK' })
    const nlGroup = gkOf({ booking_no: 'B1368248010', so_no: '29954607', hbl_awb_fcr_no: 'HBL-NL' })
    expect(findSupersededByIdentityCorrection([ukSibling], nlGroup, 'LEG-NL')).toEqual([])
    // and the two functions must AGREE about what that leg is
    expect(findSiblingBooking([{ ...ukSibling, bookingId: 'BOOK-1' }], nlGroup)).toBe('BOOK-1')
  })

  it('an hbl-bearing leg is spared even when the committed group has no hbl of its own (#151)', () => {
    // a booking-layer-only SO email must never retire a leg that already has its own B/L
    const legWithBl = sleg('LEG-BL', { booking_no: 'B1', so_no: 'SO-OLD', hbl_awb_fcr_no: 'HBL-1' })
    expect(findSupersededByIdentityCorrection([legWithBl], gkOf({ booking_no: 'B1', so_no: 'SO-NEW' }), 'NEW')).toEqual([])
  })

  it('the SAME hbl on both sides + a booking-layer re-key still retires (same ship, re-keyed)', () => {
    const reKeyed = sleg('OLD', { booking_no: 'B1', so_no: 'SO-OLD', hbl_awb_fcr_no: 'HBL-1' })
    const group = gkOf({ booking_no: 'B1', so_no: 'SO-NEW', hbl_awb_fcr_no: 'HBL-1' })
    expect(findSupersededByIdentityCorrection([reKeyed], group, 'NEW').map((x) => x.id)).toEqual(['OLD'])
  })

  it('the BEFF01 ghost still retires (booking-layer conflict + booking-layer overlap) (#151)', () => {
    const ghost = sleg('GHOST', { booking_no: 'B1368248010', so_no: 'BEFF01-001627' })
    const groupNew = gkOf({ booking_no: 'B1368248010', so_no: '29954607' })
    expect(findSupersededByIdentityCorrection([ghost], groupNew, 'NEW').map((x) => x.id)).toEqual(['GHOST'])
  })

  it('missing reviewStatus is treated as provisional', () => {
    const zombie = sleg('OLD', { booking_no: 'BX1', so_no: 'SO-OLD' }, { reviewStatus: undefined })
    delete (zombie as { reviewStatus?: string }).reviewStatus
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    expect(findSupersededByIdentityCorrection([zombie], newKeys, 'NEW').map((x) => x.id)).toEqual(['OLD'])
  })
})

describe('findSiblingBooking (#151 — same booking value, different HBL → legNo N, not a new booking)', () => {
  const legNL = {
    id: 'LEG-NL',
    bookingId: 'BOOK-1',
    matchKeys: { booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-NL' },
    dismissedAt: null as Date | null,
    linkedShipmentId: null as string | null,
  }

  it('group with the SAME booking value and its OWN hbl → that bookingId', () => {
    const gk = gkOf({ booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-UK' })
    expect(findSiblingBooking([legNL], gk)).toBe('BOOK-1')
  })
  it('different booking VALUE → undefined (a different booking is a different shipment family)', () => {
    const gk = gkOf({ booking_no: 'B-OTHER', hbl_awb_fcr_no: 'HBL-UK' })
    expect(findSiblingBooking([legNL], gk)).toBeUndefined()
  })
  it('group without its own hbl → undefined (nothing to file the leg under)', () => {
    expect(findSiblingBooking([legNL], gkOf({ booking_no: 'B1368248010' }))).toBeUndefined()
  })
  it("same hbl on both sides → undefined (that is findExistingLeg's match, not a sibling)", () => {
    expect(findSiblingBooking([legNL], gkOf({ booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-NL' }))).toBeUndefined()
  })
  it('candidates spanning TWO bookings → undefined (ambiguous — create a fresh booking instead)', () => {
    const legX = { ...legNL, id: 'LEG-X', bookingId: 'BOOK-2' }
    const gk = gkOf({ booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-UK' })
    expect(findSiblingBooking([legNL, legX], gk)).toBeUndefined()
  })
  it('linked husks never anchor a sibling attach', () => {
    const husk = { ...legNL, linkedShipmentId: 'GONE' }
    expect(findSiblingBooking([husk], gkOf({ booking_no: 'B1368248010', hbl_awb_fcr_no: 'HBL-UK' }))).toBeUndefined()
  })
})

describe('findExistingLeg — the AWB alias must not read as a strong-key CONFLICT', () => {
  // This is the exact path that minted a duplicate on 2026-07-26. A decision carrying
  // hbl=SZA26050003 met a leg committed under hbl=A26050003 (the bare-A form the forwarder writes in the
  // email SUBJECT, "BL#A26050003 ELGC// …"). Same type, unequal value ⇒ strongKeysConflict fired at the top
  // of the loop and `continue`d — so the MBL, which DID overlap, never got a chance to match. The committer
  // inserted JOB-2026-0010 beside JOB-2026-0003 for one shipment.
  const legMk = { hbl_awb_fcr_no: 'A26050003', mbl: '99992908152', booking_no: 'CA771' }
  const groupMk = { hbl_awb_fcr_no: 'SZA26050003', mbl: '999-92908152' }

  it('matches the existing leg instead of spawning a duplicate', () => {
    const legs = [leg('L-0003', 'B-0003', legMk)]
    const found = findExistingLeg(legs, new Map([['B-0003', ['1570988']]]), gkOf(groupMk), posSet('1570988'), null)
    expect(found?.id).toBe('L-0003')
  })

  it('still matches when the group states ONLY the aliased HBL (no MBL to fall back on)', () => {
    const legs = [leg('L-0003', 'B-0003', { hbl_awb_fcr_no: 'A26050003' })]
    const found = findExistingLeg(legs, new Map(), gkOf({ hbl_awb_fcr_no: 'SZA26050003' }), new Set(), null)
    expect(found?.id).toBe('L-0003')
  })

  it('a genuinely different HBL is still a conflict and still spawns a new leg', () => {
    const legs = [leg('L-A', 'B-A', { hbl_awb_fcr_no: 'GZL26258522', mbl: '99992908152' })]
    // shares the MBL, but the HBLs are different real waybills — must NOT be amended
    const found = findExistingLeg(legs, new Map(), gkOf({ hbl_awb_fcr_no: 'GZL26261147', mbl: '999-92908152' }), new Set(), null)
    expect(found).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------------------------
// 0028 — the two rules that must not act automatically on a leg a PERSON typed.
// ---------------------------------------------------------------------------------------------

describe('findSupersededByIdentityCorrection — a hand-typed leg is never a re-parse ghost', () => {
  // The BEFF01 shape: booking_no shared, so_no conflicting. For two AGENT legs that reads "the same
  // shipment, re-keyed by a better parse", and retiring the older one is right. A person's leg makes
  // the identical shape mean something else — they typed the number they held, and the disagreement
  // is between a human and an email, not between two readings by the same reader.
  const ghost = { id: 'GHOST', bookingId: 'B1', matchKeys: { booking_no: 'BK1', so_no: 'SHIPMENT-REF' }, reviewStatus: 'provisional' }
  const gk = gkOf({ booking_no: 'BK1', so_no: 'ORDER-NO' })

  it('still retires the agent ghost (unchanged)', () => {
    expect(findSupersededByIdentityCorrection([ghost], gk, 'NEW').map((l) => l.id)).toEqual(['GHOST'])
  })

  it('does NOT retire the same leg once it is marked hand-typed', () => {
    const typed = { ...ghost, createdManually: true }
    expect(findSupersededByIdentityCorrection([typed], gk, 'NEW')).toEqual([])
  })

  it('reports it instead — the situation still reaches a human, it just is not settled for them', () => {
    const typed = { ...ghost, createdManually: true }
    expect(findManualIdentityClash([typed], gk, 'NEW').map((l) => l.id)).toEqual(['GHOST'])
    // and the agent ghost does NOT double-report: it was already retired
    expect(findManualIdentityClash([ghost], gk, 'NEW')).toEqual([])
  })
})

describe('findPoOnlyDuplicateRisk — the blind spot where a hand-typed leg loses its follow-up email', () => {
  // The operator creates a leg because the booking mail was never ingested, entering the booking
  // number from the forwarder's WeChat message. The forwarder's later email cites the HBL and the same
  // PO — but not that booking number. findExistingLeg cannot match (both sides carry a strong id, so
  // the shared-PO branch is closed) and the two legs never meet.
  const typed = { id: 'HUMAN', bookingId: 'B-H', matchKeys: { booking_no: 'BK1' }, createdManually: true }
  const posByBooking = new Map([['B-H', ['PO-1']]])
  const gk = gkOf({ hbl_awb_fcr_no: 'HBL-9' })

  it('surfaces the hand-typed leg the email could not reach', () => {
    expect(findPoOnlyDuplicateRisk([typed], posByBooking, gk, posSet('PO-1'), false, 'NEW').map((l) => l.id)).toEqual(['HUMAN'])
  })

  it('stays quiet for two AGENT legs — one PO shipping across shipments is the ordinary case', () => {
    const agentLeg = { ...typed, createdManually: false }
    expect(findPoOnlyDuplicateRisk([agentLeg], posByBooking, gk, posSet('PO-1'), false, 'NEW')).toEqual([])
  })

  it('fires in the other direction too: a manual CREATE landing beside an existing agent leg', () => {
    const agentLeg = { ...typed, createdManually: false }
    expect(
      findPoOnlyDuplicateRisk([agentLeg], posByBooking, gk, posSet('PO-1'), true, 'NEW').map((l) => l.id),
    ).toEqual(['HUMAN'])
  })

  it('never fires when the two CONFLICT on one id type — that is positive evidence of two shipments', () => {
    // same type (booking_no), different values → the re-key path owns this, not the duplicate path
    expect(findPoOnlyDuplicateRisk([typed], posByBooking, gkOf({ booking_no: 'BK2' }), posSet('PO-1'), false, 'NEW')).toEqual([])
  })

  it('never fires when they already OVERLAP on a strong key — findExistingLeg matched them', () => {
    expect(findPoOnlyDuplicateRisk([typed], posByBooking, gkOf({ booking_no: 'BK1' }), posSet('PO-1'), false, 'NEW')).toEqual([])
  })

  it('never fires when the other leg has NO identity — the shared-PO branch already reaches it', () => {
    const nascent = { ...typed, matchKeys: {} }
    expect(findPoOnlyDuplicateRisk([nascent], posByBooking, gk, posSet('PO-1'), false, 'NEW')).toEqual([])
  })

  it('ignores legs a human already retired, and the leg this commit just wrote', () => {
    const dismissed = { ...typed, dismissedAt: new Date() }
    const folded = { ...typed, id: 'FOLDED', linkedShipmentId: 'ELSEWHERE' }
    expect(findPoOnlyDuplicateRisk([dismissed, folded], posByBooking, gk, posSet('PO-1'), false, 'NEW')).toEqual([])
    expect(findPoOnlyDuplicateRisk([typed], posByBooking, gk, posSet('PO-1'), false, 'HUMAN')).toEqual([])
  })

  it('no PO in common → nothing to link them by, nothing to say', () => {
    expect(findPoOnlyDuplicateRisk([typed], posByBooking, gk, posSet('PO-OTHER'), false, 'NEW')).toEqual([])
  })
})
