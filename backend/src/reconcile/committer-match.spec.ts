import { describe, it, expect } from 'vitest'
import { findExistingLeg, findAdoptableZeroIdLeg } from './committer-match'
import { strongKeys, normKey } from './match-keys'

type Leg = { id: string; bookingId: string; matchKeys: Record<string, unknown> }
const leg = (id: string, bookingId: string, matchKeys: Record<string, unknown>): Leg => ({ id, bookingId, matchKeys })
const gkOf = (mk: Record<string, unknown>) => strongKeys(mk)
const posSet = (...pos: string[]) => new Set(pos.map(normKey).filter(Boolean))

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
