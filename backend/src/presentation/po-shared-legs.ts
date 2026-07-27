/**
 * "This PO is already on another shipment" — with the other shipment attached.
 *
 * The review reason was prose and nothing else. The desk could say a PO was shared but not WHERE, so
 * the operator had no way to separate the three things it can mean — a deliberate split, a switch of
 * transport mode, or a mis-link — and the card degraded into offering PO editing, which answers none
 * of them.
 *
 * This assembles the reference: for each shared PO, the legs that also carry it, each with the facts
 * the judgement turns on (mode, ETD/ATD, its own shipped quantity).
 *
 * Deliberately FACTS, not a verdict. `crossMode` states that two legs record different transport
 * modes; it does not conclude "this is a mode change", because a split across sea and air and a
 * mis-link look identical from here and only the operator has the context to tell them apart. Per the
 * de-correction rule the desk surfaces what is true and lets a human decide.
 */

export type PoSharedLegRow = {
  poNumber: string
  shipmentId: string
  bookingNo: string | null
  soNo: string | null
  hblAwbFcrNo: string | null
  mode: string | null
  etd: Date | string | null
  atd: Date | string | null
  state: string | null
  legNo: number | null
  dismissedAt: Date | string | null
  reviewStatus: string | null
  legQty: number | null
  legQtyUnit: string | null
  shipmentCreatedAt?: Date | string | null
  firstEmailAt?: Date | string | null
}

/** One other leg carrying the same PO. */
export type SharedPoLeg = {
  shipmentId: string
  /**
   * Anchor for the derived Shipment ID (`formatShipmentId`) — the name a leg answers to on every
   * other screen. Without it this panel labelled siblings by booking number, which is exactly the
   * "same leg, two names on two surfaces" problem #350 removed from the focus page.
   */
  idAnchorAt: string | null
  /** Whichever identity the sibling actually has — the operator matches on this, not on the uuid. */
  bookingNo: string | null
  soNo: string | null
  hblAwbFcrNo: string | null
  mode: string | null
  etd: string | null
  atd: string | null
  state: string | null
  legNo: number | null
  /** Off the desk already — a rejected sibling explains an overlap instead of competing with it. */
  dismissed: boolean
  /** Still awaiting review itself, so its numbers are provisional too. */
  provisional: boolean
  /** The SIBLING's cargo total, on the same basis as ours — the comparison that says whether this
   *  is a split. */
  legQty: number | null
  legQtyUnit: string | null
  /** This leg and that one record different transport modes. A fact, not a conclusion. */
  crossMode: boolean
}

export type SharedPo = {
  poNumber: string
  /** THIS leg's cargo total — the same figure its detail page prints as "shipment total N <unit>". */
  legQty: number | null
  legQtyUnit: string | null
  others: SharedPoLeg[]
  /** Any sibling on a different mode — lets the desk lead with the sea/air question when it applies. */
  anyCrossMode: boolean
}

const iso = (v: Date | string | null | undefined): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v)

const norm = (v: string | null | undefined): string => String(v ?? '').trim().toUpperCase()

/**
 * @param rows  poSiblingLegs() output for this leg
 * @param leg   this leg's mode (for the crossMode comparison) and its own cargo total
 *
 * Both sides of the comparison are LEG totals — the same figure the detail page prints as
 * "shipment total N <unit>" and the PO card repeats. The per-PO `shipment_pos` quantity was the
 * obvious source and the wrong one: it carries the ORDERED unit, so a leg that shipped 3 cartons
 * against an order counted in pieces was announced here as "this shipment ships 3 pieces" while
 * every other screen said 3 cartons.
 */
export function sharedPos(
  rows: PoSharedLegRow[],
  leg: { mode?: string | null; qty?: number | null; qtyUnit?: string | null },
): SharedPo[] {
  const thisMode = leg.mode
  const byPo = new Map<string, SharedPo>()

  for (const r of rows) {
    const poNumber = String(r.poNumber ?? '').trim()
    if (poNumber === '' || !r.shipmentId) continue

    let group = byPo.get(poNumber)
    if (!group) {
      group = {
        poNumber,
        legQty: leg.qty ?? null,
        legQtyUnit: leg.qtyUnit ?? null,
        others: [],
        anyCrossMode: false,
      }
      byPo.set(poNumber, group)
    }
    // The same sibling can join twice when a PO is linked more than once; keep one row per leg.
    if (group.others.some((o) => o.shipmentId === r.shipmentId)) continue
    /**
     * A REJECTED leg is not a competing claim. If every other holder of a PO has been thrown away
     * then this leg is the only shipment for it and there is nothing to confirm — leg 256BB7D0 raised
     * "7 POs are also on other shipments" where all seven pointed at one rejected header-row leg.
     * Filtered in SQL too; kept here so the rule is stated where the shape is decided.
     */
    if (r.dismissedAt != null) continue

    const mine = norm(thisMode)
    const theirs = norm(r.mode)
    const crossMode = mine !== '' && theirs !== '' && mine !== theirs

    group.others.push({
      shipmentId: r.shipmentId,
      // Beginning email anchors the id; createdAt is the fallback, same rule as the focus page.
      idAnchorAt: iso(r.firstEmailAt ?? null) ?? iso(r.shipmentCreatedAt ?? null),
      bookingNo: r.bookingNo ?? null,
      soNo: r.soNo ?? null,
      hblAwbFcrNo: r.hblAwbFcrNo ?? null,
      mode: r.mode ?? null,
      etd: iso(r.etd),
      atd: iso(r.atd),
      state: r.state ?? null,
      legNo: r.legNo ?? null,
      dismissed: r.dismissedAt != null,
      provisional: String(r.reviewStatus ?? '') === 'provisional',
      legQty: r.legQty ?? null,
      legQtyUnit: r.legQtyUnit ?? null,
      crossMode,
    })
    if (crossMode) group.anyCrossMode = true
  }

  // A group whose every sibling was rejected has nothing left to ask about.
  return [...byPo.values()]
    .filter((g) => g.others.length > 0)
    .sort((a, b) => a.poNumber.localeCompare(b.poNumber))
}
