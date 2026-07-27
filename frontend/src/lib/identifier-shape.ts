/**
 * "That is not a shipment number, that is a column header."
 *
 * A spreadsheet was parsed with its header row treated as data, and two of its cells became shipment
 * legs: one whose SO number is `SO no.` and one whose SO number is `PORT OF LOADING` (legs DEEC1FC0
 * and 01B94D12 on the dev DB, 2 of 201). Both sat in the review queue as provisional work, and both
 * were being offered to operators as legs to MERGE INTO — an irreversible action against a row that
 * describes nothing.
 *
 * The rule is the mirror of isNonPartyName, which rejects a "company" carrying no letter because that
 * is a PO or container number that leaked into a party field: a shipment identifier carrying **no
 * digit** is not an identifier. Every real one has digits — FENLSO003044, TN#1075317470#BKG,
 * FCR001379073 — and neither header does.
 *
 * Deliberately a shape test rather than a list of known header words ("SO no.", "PORT OF LOADING",
 * "VESSEL", …). Such a list only ever covers the spreadsheets someone has already seen, and rots.
 *
 * This does NOT correct anything. Per the de-correction principle the value stays exactly as parsed —
 * the leg keeps its `SO no.`, and the queue's learner still sees what it produced. What changes is
 * that the desk stops recommending it, and says why.
 */

/** Present, but with no digit anywhere — so it cannot be a booking / SO / B/L / container number. */
export function isNonIdentifier(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim()
  if (s === '') return false // absent is not the same as malformed
  return !/\d/.test(s)
}

/** A value we would be willing to identify a shipment by. */
export function isUsableIdentifier(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').trim()
  return s !== '' && /\d/.test(s)
}

/**
 * Every identifier this candidate offers is unusable — nothing on it can name a shipment, so picking
 * it would merge live cargo into a row parsed out of a header.
 *
 * A candidate with NO identifiers at all is not junk, just thin (it may still be identified by PO), so
 * it stays. Only one that carries identifier fields which are all digit-free is rejected.
 */
export function isNonIdentifiableCandidate(c: {
  so_no?: string | null
  booking_no?: string | null
  hbl_awb_fcr_no?: string | null
  mbl?: string | null
  container_no?: string | null
}): boolean {
  const values = [c.so_no, c.booking_no, c.hbl_awb_fcr_no, c.mbl, c.container_no]
  const present = values.filter((v) => String(v ?? '').trim() !== '')
  if (present.length === 0) return false
  return present.every((v) => isNonIdentifier(v))
}

/** The offending values, for copy that names them instead of gesturing at them. */
export function nonIdentifierValues(c: {
  so_no?: string | null
  booking_no?: string | null
  hbl_awb_fcr_no?: string | null
  mbl?: string | null
  container_no?: string | null
}): string[] {
  return [c.so_no, c.booking_no, c.hbl_awb_fcr_no, c.mbl, c.container_no]
    .map((v) => String(v ?? '').trim())
    .filter((v) => v !== '' && isNonIdentifier(v))
}
