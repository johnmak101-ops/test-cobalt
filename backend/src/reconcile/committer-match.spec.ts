import { describe, it, expect } from 'vitest'
import { findExistingLeg, findAdoptableZeroIdLeg, findSupersededByIdentityCorrection } from './committer-match'
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

  it('missing reviewStatus is treated as provisional', () => {
    const zombie = sleg('OLD', { booking_no: 'BX1', so_no: 'SO-OLD' }, { reviewStatus: undefined })
    delete (zombie as { reviewStatus?: string }).reviewStatus
    const newKeys = gkOf({ booking_no: 'BX1', so_no: 'SO-NEW' })
    expect(findSupersededByIdentityCorrection([zombie], newKeys, 'NEW').map((x) => x.id)).toEqual(['OLD'])
  })
})
