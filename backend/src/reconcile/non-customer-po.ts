/**
 * Detect packing-line / LC / invoice tokens that the extract put in customer_po slots.
 * Defense-in-depth for planPoReconcile — queue validate should demote at source too.
 *
 * Patterns from DEMO Set6 gold: ASNE* (export LC), DF* (invoice/style), and
 * pure 9+ digit packing-line ids (e.g. 319001345) — always non-customer, even alone
 * (standalone groups were minting incomplete "1 PO" shells with Booking —).
 */

/** LC / declaration / invoice-style tokens that are never a Cobalt customer PO. */
export function isLikelyNonCustomerPo(po: string | null | undefined): boolean {
  if (po == null) return false
  const s = String(po).trim()
  if (!s) return false
  // Export LC / declaration refs (e.g. ASNE24054844907 on Strauss packing lists)
  if (/^ASNE\d{8,}$/i.test(s)) return true
  // Invoice / style codes (e.g. DF2026G031)
  if (/^DF\d{4}[A-Z0-9]+$/i.test(s)) return true
  // Packing-line pure-digit ids (Set6 31900… family). Always demote — never mint PO masters/shells.
  if (/^\d{9,}$/.test(s)) return true
  return false
}

const pureDigits = (s: string) => /^\d+$/.test(s)

/**
 * When a group carries both a short real PO and several long pure-digit packing-line ids,
 * demote the long digits. Set5 5-digit POs are untouched (no short+long mix of this shape).
 */
export function demotePackingLinePos(pos: string[]): { keep: string[]; demoted: string[] } {
  const demoted: string[] = []
  const candidates: string[] = []
  for (const p of pos) {
    const s = String(p).trim()
    if (!s) continue
    if (isLikelyNonCustomerPo(s)) {
      demoted.push(s)
      continue
    }
    candidates.push(s)
  }
  const shortDigit = candidates.filter((p) => pureDigits(p) && p.length >= 5 && p.length <= 8)
  const longDigit = candidates.filter((p) => pureDigits(p) && p.length >= 9)
  // ≥2 long packing-line ids + ≥1 shorter real PO → demote the long ones
  if (shortDigit.length >= 1 && longDigit.length >= 2) {
    const longSet = new Set(longDigit)
    const keep = candidates.filter((p) => !longSet.has(p))
    return { keep, demoted: [...demoted, ...longDigit] }
  }
  return { keep: candidates, demoted }
}
