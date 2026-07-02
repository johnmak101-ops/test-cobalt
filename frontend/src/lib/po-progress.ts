/**
 * Lifecycle-weighted PO progress — progress aligns with shipments, not with allocation.
 * A PO fully booked onto a shipment that hasn't moved is 15% along, not 100% "fulfilled";
 * quantity only counts as *shipped* once its shipment is SAILED or beyond.
 *
 * Status accepts both vocabularies the API emits: raw leg states (RELEASED/DELIVERED, e.g.
 * the PO list's `status`) and the UI staircase (DEPARTED/ARRIVED, e.g. linked-shipment rows).
 */
export const SHIPMENT_STATUS_PCT: Record<string, number> = {
  BOOKED: 15,
  CONFIRMED: 30,
  AT_WAREHOUSE: 45,
  SAILED: 65,
  RELEASED: 85,
  DEPARTED: 85,
  DELIVERED: 100,
  ARRIVED: 100,
}

/** SAILED and beyond — the goods are physically on the move. */
const SHIPPED_FLOOR_PCT = SHIPMENT_STATUS_PCT.SAILED

export interface PoShipmentLink {
  status?: string | null
  linkedQuantity?: number | null
}

export interface PoProgress {
  /** 0–100. Quantity-weighted lifecycle position when link quantities are known, else the furthest shipment's position. */
  pct: number
  /** Quantity on pre-departure (BOOKED…AT_WAREHOUSE) shipments. Null when no link carries a quantity. */
  bookedQuantity: number | null
  /** Quantity on SAILED-and-beyond shipments. Null when no link carries a quantity. */
  shippedQuantity: number | null
}

const statusPct = (s: string | null | undefined): number =>
  SHIPMENT_STATUS_PCT[s ?? ''] ?? SHIPMENT_STATUS_PCT.BOOKED

export function poProgress(
  totalQuantity: number | null | undefined,
  links: PoShipmentLink[],
): PoProgress {
  const active = links.filter((l) => l.status !== 'CANCELLED')
  const hasQty = active.some((l) => l.linkedQuantity != null)

  const bookedQuantity = hasQty
    ? active.reduce((s, l) => (statusPct(l.status) < SHIPPED_FLOOR_PCT ? s + (l.linkedQuantity ?? 0) : s), 0)
    : null
  const shippedQuantity = hasQty
    ? active.reduce((s, l) => (statusPct(l.status) >= SHIPPED_FLOOR_PCT ? s + (l.linkedQuantity ?? 0) : s), 0)
    : null

  if (active.length === 0) return { pct: 0, bookedQuantity, shippedQuantity }

  const allocated = active.reduce((s, l) => s + (l.linkedQuantity ?? 0), 0)
  // Over-allocated POs weight over what's actually on shipments so pct stays ≤ 100.
  const denom = totalQuantity && totalQuantity > 0 ? Math.max(totalQuantity, allocated) : allocated

  if (hasQty && denom > 0) {
    const weighted = active.reduce((s, l) => s + (l.linkedQuantity ?? 0) * statusPct(l.status), 0)
    return { pct: Math.min(weighted / denom, 100), bookedQuantity, shippedQuantity }
  }

  // No quantities anywhere — fall back to the furthest shipment's lifecycle position.
  return { pct: Math.max(...active.map((l) => statusPct(l.status))), bookedQuantity, shippedQuantity }
}

/**
 * Human-readable progress text — never a percentage (reviewers don't know what "15%" means).
 * With quantities: "0/2 shipped". Without: the furthest shipment's lifecycle word ("at warehouse").
 */
export function progressLabel(
  totalQuantity: number | null | undefined,
  links: PoShipmentLink[],
): string {
  const active = links.filter((l) => l.status !== 'CANCELLED')
  if (active.length === 0) return links.length > 0 ? 'cancelled' : '—'

  const p = poProgress(totalQuantity, links)
  if (p.shippedQuantity != null) {
    const allocated = (p.bookedQuantity ?? 0) + p.shippedQuantity
    const denom = totalQuantity && totalQuantity > 0 ? totalQuantity : allocated
    return `${p.shippedQuantity}/${denom} shipped`
  }

  const furthest = active.reduce((a, b) => (statusPct(b.status) > statusPct(a.status) ? b : a))
  return String(furthest.status ?? 'BOOKED').replace(/_/g, ' ').toLowerCase()
}
