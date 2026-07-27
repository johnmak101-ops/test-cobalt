import { describe, it, expect } from 'vitest'
import { sharedPos, type PoSharedLegRow } from './po-shared-legs'

const row = (over: Partial<PoSharedLegRow> = {}): PoSharedLegRow => ({
  poNumber: '28631',
  shipmentId: 'other-leg',
  bookingNo: 'FENLSO003044',
  soNo: null,
  hblAwbFcrNo: null,
  mode: 'SEA',
  etd: new Date('2026-02-08T00:00:00.000Z'),
  atd: null,
  state: 'BOOKED',
  legNo: 1,
  dismissedAt: null,
  reviewStatus: 'confirmed',
  legQty: 400,
  legQtyUnit: 'PCS',
  ...over,
})

describe('sharedPos — the reference under "this PO is already on another shipment"', () => {
  it('names the other leg instead of gesturing at it', () => {
    const [group] = sharedPos([row()], { mode: 'SEA', qty: 600, qtyUnit: 'PCS' })
    expect(group?.poNumber).toBe('28631')
    // our own LEG total rides along — the figure every other screen prints for this shipment
    expect(group?.legQty).toBe(600)
    expect(group?.others).toHaveLength(1)
    expect(group?.others[0]).toMatchObject({
      shipmentId: 'other-leg',
      bookingNo: 'FENLSO003044',
      mode: 'SEA',
      legQty: 400,
      crossMode: false,
    })
    expect(group?.others[0]?.etd).toBe('2026-02-08T00:00:00.000Z')
  })

  /**
   * The sea/air question the operator actually asks. Stated as a FACT about two modes — never as a
   * verdict that this IS a mode change, because a deliberate cross-mode split and a mis-link look
   * identical from here (de-correction: surface, do not decide).
   */
  it('flags a different transport mode without concluding what it means', () => {
    const [group] = sharedPos([row({ mode: 'AIR' })], { mode: 'SEA' })
    expect(group?.anyCrossMode).toBe(true)
    expect(group?.others[0]?.crossMode).toBe(true)
  })

  it('does not call it cross-mode when either side has no mode', () => {
    expect(sharedPos([row({ mode: null })], { mode: 'SEA' })[0]?.anyCrossMode).toBe(false)
    expect(sharedPos([row({ mode: 'AIR' })], { mode: null })[0]?.anyCrossMode).toBe(false)
  })

  /**
   * A rejected leg is not a competing claim. Leg 256BB7D0 raised "7 POs on this leg are also on
   * other shipments" where all seven pointed at the SAME rejected header-row leg (`PO # :`) — seven
   * alarms about a row someone had already thrown away. If every other holder is rejected, this leg
   * is the only shipment for the PO and there is nothing to confirm.
   */
  it('drops a group whose only sibling was rejected — there is nothing left to ask', () => {
    expect(sharedPos([row({ dismissedAt: new Date('2026-02-10T00:00:00.000Z') })], { mode: 'SEA' })).toEqual([])
  })

  it('keeps the live siblings and ignores the rejected ones', () => {
    const [group] = sharedPos(
      [
        row({ shipmentId: 'dead', dismissedAt: new Date('2026-02-10T00:00:00.000Z') }),
        row({ shipmentId: 'live' }),
      ],
      { mode: 'SEA' },
    )
    expect(group?.others.map((o) => o.shipmentId)).toEqual(['live'])
  })

  it('a rejected sibling does not make it look cross-mode', () => {
    // else a thrown-away AIR leg would keep raising the sea/air question on a settled SEA shipment
    const groups = sharedPos([row({ mode: 'AIR', dismissedAt: new Date() })], { mode: 'SEA' })
    expect(groups).toEqual([])
  })

  it('marks a sibling that is itself still under review', () => {
    const [group] = sharedPos([row({ reviewStatus: 'provisional' })], { mode: 'SEA' })
    expect(group?.others[0]?.provisional).toBe(true)
  })

  it('groups several POs and de-duplicates a leg linked twice', () => {
    const groups = sharedPos(
      [
        row({ poNumber: '28770', shipmentId: 'a' }),
        row({ poNumber: '28631', shipmentId: 'b' }),
        row({ poNumber: '28631', shipmentId: 'b' }),
      ],
      { mode: 'SEA' },
    )
    expect(groups.map((g) => g.poNumber)).toEqual(['28631', '28770'])
    expect(groups[0]?.others).toHaveLength(1)
  })

  /**
   * Leg 202605C7BD shipped 3 CARTONS against an order counted in pieces, and the panel announced
   * "this shipment ships 3 pieces" while its own detail page said "shipment total 3 cartons". Both
   * sides of the comparison are leg totals now — the shipment_pos link carries the ORDERED unit and
   * is not what any other screen prints.
   */
  it('states each side in the leg own unit, not the PO link ordered unit', () => {
    const [group] = sharedPos(
      // the link row said pieces; the sibling leg itself shipped cartons
      [row({ legQty: 207, legQtyUnit: 'cartons' })],
      { mode: 'AIR', qty: 3, qtyUnit: 'cartons' },
    )
    expect(group?.legQty).toBe(3)
    expect(group?.legQtyUnit).toBe('cartons')
    expect(group?.others[0]?.legQty).toBe(207)
    expect(group?.others[0]?.legQtyUnit).toBe('cartons')
  })

  it('is empty when no PO is shared — the desk then says nothing', () => {
    expect(sharedPos([], { mode: 'SEA' })).toEqual([])
  })

  it('drops rows with no PO number or no sibling id', () => {
    expect(sharedPos([row({ poNumber: '  ' })], { mode: 'SEA' })).toEqual([])
    expect(sharedPos([row({ shipmentId: '' })], { mode: 'SEA' })).toEqual([])
  })
})
