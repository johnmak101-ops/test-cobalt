import type { CriticConflict } from './critic-review'
import { mapCriticFieldToColumn } from './review-fields'

export function normalizeQty(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim()
  const m = s.match(/^(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function isQtyConflict(c: CriticConflict): boolean {
  return mapCriticFieldToColumn(c.field) === 'qty'
}

export function liveQtyFromShipment(shipment: {
  quantityShipped?: number | null
}): number | null {
  return normalizeQty(shipment.quantityShipped)
}

export function poShipmentTotalFromLinked(
  linkedPOs: Array<{
    quantity?: number | null
    totalQuantity?: number | null
    sharedBroadcastTotal?: number | null
  }>,
): number | null {
  if (!linkedPOs.length) return null
  const b = linkedPOs[0]?.sharedBroadcastTotal
  const bn = normalizeQty(b)
  if (bn != null) return bn
  let sum = 0
  for (const p of linkedPOs) {
    const q = normalizeQty(p.quantity ?? p.totalQuantity)
    if (q == null) return null
    sum += q
  }
  return sum
}

function nonSystemValues(c: CriticConflict): number[] {
  const out: number[] = []
  for (const x of c.candidates) {
    if (x.source.trim().toLowerCase() === 'system') continue
    const n = normalizeQty(x.value)
    if (n != null) out.push(n)
  }
  return out
}

function allCandidateValues(c: CriticConflict): number[] {
  return c.candidates
    .map((x) => normalizeQty(x.value))
    .filter((n): n is number => n != null)
}

export function isQtySettled(
  conflict: CriticConflict,
  opts: { liveQty: number | null; poShipmentTotal: number | null },
): boolean {
  if (!isQtyConflict(conflict)) return false
  const { liveQty, poShipmentTotal } = opts
  if (liveQty == null) return false
  const nonSys = nonSystemValues(conflict)
  // S1
  if (nonSys.some((n) => n === liveQty)) return true
  // S3
  const all = allCandidateValues(conflict)
  if (all.length > 0 && all.every((n) => n === liveQty)) return true
  // S2
  if (poShipmentTotal != null && poShipmentTotal === liveQty) return true
  return false
}

export function filterActionableConflicts(
  conflicts: CriticConflict[],
  opts: { liveQty: number | null; poShipmentTotal: number | null },
): CriticConflict[] {
  return conflicts.filter((c) => {
    if (!isQtyConflict(c)) return true
    return !isQtySettled(c, opts)
  })
}

export function existingQtyDisplay(
  conflict: CriticConflict,
  liveQty: number | null,
): string | null {
  if (!isQtyConflict(conflict)) return null
  if (liveQty == null) return null
  return String(liveQty)
}
