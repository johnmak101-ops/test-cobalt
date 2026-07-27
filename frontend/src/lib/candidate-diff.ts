/**
 * Show what DIFFERS between candidate shipments, not everything about each.
 *
 * The five legs offered for leg A84B3B1A all read:
 *   SO S13784413 · HBL FCR0013786xx · JOB JOB-2026-0005 · MAASTRICHT MAERSK · ETD 28 Jul 2026 ·
 *   PO B13756523, B13756132
 * SO identical, JOB identical, PO identical, vessel identical on four of five, ETD identical on four
 * of five. Only the HBL and the container actually differed — and they sat in the middle of the
 * longest line, so choosing meant diffing five near-identical blocks by eye.
 *
 * So: hoist what every candidate shares into one line above the list, and let each row carry only the
 * fields that tell it apart.
 */

export type CandidateFacts = {
  shipmentId: string
  jobNo?: string | null
  so_no?: string | null
  booking_no?: string | null
  hbl_awb_fcr_no?: string | null
  mbl?: string | null
  container_no?: string | null
  vesselOrFlight?: string | null
  etd?: string | null
  customerLabel?: string | null
  pos?: string[]
}

/** Field order follows how an operator identifies a shipment: strong keys first, context after. */
const FIELDS: { key: keyof CandidateFacts; label: string; identifier: boolean }[] = [
  { key: 'hbl_awb_fcr_no', label: 'HBL', identifier: true },
  { key: 'booking_no', label: 'BK', identifier: true },
  { key: 'mbl', label: 'MBL', identifier: true },
  { key: 'container_no', label: 'CTR', identifier: true },
  { key: 'so_no', label: 'SO', identifier: true },
  { key: 'vesselOrFlight', label: '', identifier: false },
  { key: 'etd', label: 'ETD', identifier: false },
  { key: 'customerLabel', label: '', identifier: false },
  { key: 'jobNo', label: 'JOB', identifier: false },
]

function valueOf(c: CandidateFacts, key: keyof CandidateFacts): string {
  const v = c[key]
  if (Array.isArray(v)) return v.join(', ')
  return String(v ?? '').trim()
}

export type CandidateDiff = {
  /** Present and identical on every candidate — printed once, above the list. */
  shared: { key: string; label: string; value: string }[]
  /** Differs between candidates (or is missing on some) — printed on each row. */
  differing: { key: string; label: string; identifier: boolean }[]
  /** Identifier fields no candidate carries at all — why the operator cannot pick by B/L. */
  absentIdentifiers: string[]
}

/**
 * Split the candidate fields three ways.
 *
 * A field missing on SOME candidates counts as differing, not shared: its absence is itself
 * distinguishing, and hoisting it would claim it of legs that do not have it.
 */
export function diffCandidates(candidates: CandidateFacts[]): CandidateDiff {
  const shared: CandidateDiff['shared'] = []
  const differing: CandidateDiff['differing'] = []
  const absentIdentifiers: string[] = []
  if (candidates.length === 0) return { shared, differing, absentIdentifiers }

  for (const { key, label, identifier } of FIELDS) {
    const values = candidates.map((c) => valueOf(c, key))
    const present = values.filter((v) => v !== '')
    if (present.length === 0) {
      if (identifier) absentIdentifiers.push(label)
      continue
    }
    const allPresent = present.length === values.length
    const allEqual = present.every((v) => v.toUpperCase() === present[0]!.toUpperCase())
    if (allPresent && allEqual) shared.push({ key: String(key), label, value: present[0]! })
    else differing.push({ key: String(key), label, identifier })
  }
  return { shared, differing, absentIdentifiers }
}
