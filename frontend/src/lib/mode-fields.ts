import { fieldLabel } from './review-fields'

/**
 * Which transport fields belong to which mode — ONE vocabulary for every surface.
 *
 * Sea carries vessel + voyage + ocean MBL; air carries flight + MAWB. This lived as private helpers
 * inside ShipmentDetailPage, so the review desk had no way to ask the question and the two surfaces
 * could not agree — the same drift `EDITABLE_FIELDS` exists to prevent for labels and pickers.
 *
 * An unknown or empty mode claims NEITHER set. Nothing is off-mode then, because we do not know what
 * the leg is: guessing would flag every unclassified leg as contradictory.
 */
export function isAirMode(mode: string | null | undefined): boolean {
  return (mode ?? '').toUpperCase().startsWith('AIR')
}
export function isSeaMode(mode: string | null | undefined): boolean {
  return (mode ?? '').toUpperCase().startsWith('SEA')
}

const SEA_ONLY = ['vesselName', 'voyageNo', 'mbl'] as const
const AIR_ONLY = ['flightNo', 'mawb'] as const

/** This column belongs to the OTHER mode — a vessel on an air leg, a flight number on a sea one. */
export function isOffModeField(column: string, mode: string | null | undefined): boolean {
  if ((SEA_ONLY as readonly string[]).includes(column)) return isAirMode(mode)
  if ((AIR_ONLY as readonly string[]).includes(column)) return isSeaMode(mode)
  return false
}

/**
 * Should this field appear on a form for a leg of this mode?
 *
 * It used to hide on mode alone, in the read view AND the edit form, which orphaned data: a leg
 * switched to SEA kept its `flightNo`, and no screen could reach it. Not the read view (hidden), not
 * the edit form (hidden), and not the review desk either — `fieldsToApply` skips empty values, so an
 * empty resolution there means "no decision", never "clear it". The value stayed in the database, the
 * API payload and every export, with nothing in the app able to touch it.
 *
 * Hiding a populated field does not remove the value. It removes the operator. So the rule is:
 * off-mode AND empty hides; off-mode AND populated always shows, flagged, with a way to clear it.
 *
 * Lived privately inside ShipmentDetailPage until the New Shipment form needed the same answer — the
 * drift this module's header describes, caught one surface later.
 */
export function shippingFieldVisible(
  dbColumn: string,
  mode: string | null | undefined,
  value?: unknown,
): boolean {
  if (!isOffModeField(dbColumn, mode)) return true
  return String(value ?? '').trim() !== ''
}

/**
 * The marker an off-mode row wears, so a stale value reads as a problem rather than as data.
 *
 * SEA and AIR are written in caps because they are the stored enum, and the Mode row prints them
 * exactly that way. Lowercasing them made the tag look like loose prose about the sea, rather than a
 * statement about this leg's Mode value.
 */
export function offModeHint(mode: string | null | undefined): string {
  return isAirMode(mode) ? 'SEA field on an AIR shipment' : 'AIR field on a SEA shipment'
}

/** The leg as this module reads it — UI keys, because both callers hold the mapped DTO. */
export type ModeFieldLeg = {
  mode?: string | null
  vesselName?: string | null
  voyageNumber?: string | null
  mblNumber?: string | null
  flightNo?: string | null
  mawb?: string | null
}

const COLUMN_TO_UI: Record<string, keyof ModeFieldLeg> = {
  vesselName: 'vesselName',
  voyageNo: 'voyageNumber',
  mbl: 'mblNumber',
  flightNo: 'flightNo',
  mawb: 'mawb',
}

/**
 * Fields this leg stores that contradict its own mode — a SEA leg holding a flight number.
 *
 * This is a data-integrity signal, not a tidiness one: either the mode was read wrong, or the value
 * came off the wrong document. Both are worth a human deciding, and neither is safe to auto-clear
 * (see the de-correction principle) — so this REPORTS and nothing here writes.
 *
 * Empty on an unknown mode, which is the safe direction: a leg nobody has classified cannot
 * contradict a classification.
 */
export function offModeFieldsOn(
  leg: ModeFieldLeg,
): { column: string; label: string; value: string }[] {
  const out: { column: string; label: string; value: string }[] = []
  for (const column of [...SEA_ONLY, ...AIR_ONLY]) {
    if (!isOffModeField(column, leg.mode)) continue
    const value = String(leg[COLUMN_TO_UI[column]!] ?? '').trim()
    if (value === '') continue
    out.push({ column, label: fieldLabel(column), value })
  }
  return out
}
