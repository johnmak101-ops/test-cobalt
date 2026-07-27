/**
 * Does this leg obviously describe a shipment?
 *
 * The desk used to ask "Is this a real shipment?" from a REASON string, so a leg with a booking
 * number, a route, dates and seven POs could still be met with that question because one audit line
 * mentioned thin mail. To an operator looking at a filled-in card that reads as the system not being
 * able to see what is in front of it — and worse, it puts a destructive button (Not a Shipment) on a
 * card whose real job is settling two field values.
 *
 * So the question is answered from the LEG'S OWN FIELDS — the same things an operator glances at —
 * and it decides which shape the card takes:
 *
 *   looks like a shipment  → "Which values are correct?"  · Edit · Keep current · Apply N
 *   does not               → "Is this a real shipment?"   · Not a Shipment · Track it · Waiting
 *
 * Never both. A card that asks whether something is freight while also asking you to pick its vendor
 * is asking you to do work it may throw away.
 */
import { isUsableIdentifier } from './identifier-shape'

/** Columns that are supposed to hold a shipment identifier, across queue-row and detail spellings. */
const IDENTIFIER_KEYS = [
  'bookingNo',
  'soNumber',
  'soNo',
  'hblNumber',
  'hblAwbFcrNo',
  'mbl',
  'containerNo',
  'mawb',
] as const

/** Fields that only a real movement has: where it goes, when it goes, what is on it. */
const SUBSTANCE_KEYS = [
  'route',
  'pol',
  'pod',
  'polRaw',
  'podRaw',
  'etd',
  'atd',
  'actualDeparture',
  'eta',
  'crd',
  'cargoReadyDate',
  'vesselName',
  'flightNo',
  'containerNo',
] as const

const str = (bag: Record<string, unknown>, key: string): string =>
  String(bag[key] ?? '').trim()

/**
 * At least one identifier that could actually name a shipment — i.e. carrying a digit.
 *
 * The digit test is the same one that catches spreadsheet headers (`PO # :`, `SO no.`): a value with
 * no digit anywhere is a column heading, not a booking number, so it cannot make a leg "real".
 */
export function hasUsableIdentifier(leg: object | null | undefined): boolean {
  if (leg == null) return false
  const bag = leg as Record<string, unknown>
  return IDENTIFIER_KEYS.some((k) => isUsableIdentifier(str(bag, k)))
}

/** Route, schedule, carrier or cargo — anything that says a real movement was described. */
export function hasShipmentSubstance(
  leg: object | null | undefined,
  linkedPOs: { poNumber?: string; quantity?: number | null }[] = [],
): boolean {
  if (leg == null) return false
  const bag = leg as Record<string, unknown>
  if (SUBSTANCE_KEYS.some((k) => str(bag, k) !== '')) return true
  // A quantity on the leg, or POs carrying one, is cargo detail — the same evidence a human reads.
  if (Number(bag.qty ?? bag.quantityShipped ?? 0) > 0) return true
  return linkedPOs.some((p) => Number(p.quantity ?? 0) > 0)
}

/**
 * The card takes its working shape only when BOTH hold: something that can name the shipment, and
 * something that describes the movement. One without the other is exactly the ambiguous case the
 * verdict shape exists for — a bare PO number, or a route with nothing to file it under.
 */
export function legLooksLikeShipment(
  leg: object | null | undefined,
  linkedPOs: { poNumber?: string; quantity?: number | null }[] = [],
): boolean {
  return hasUsableIdentifier(leg) && hasShipmentSubstance(leg, linkedPOs)
}
