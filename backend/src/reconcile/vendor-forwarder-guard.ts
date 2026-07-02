/**
 * Forwarder-as-vendor misclassification guard (pure decision).
 *
 * The LLM/parser sometimes labels a freight forwarder as the manufacturer/vendor. The committer is
 * match-only (never creates masters), so a misread usually yields a silent null link — but a forwarder
 * whose name/code collides with a vendor master (or a curated forwarder_ref) could mis-link. This guard:
 *  - L1: if the vendor_code resolves to a forwarder master/alias, do NOT link it as a vendor; if the
 *        forwarder slot is empty, fill it with that forwarder (link only — never a new master).
 *  - L3: an approved `forwarder_ref` fact forces the same, even without a forwarder master hit; an
 *        approved `vendor_name_marker` OVERRIDES the forwarder false-positive (a real vendor stays).
 * Any flag routes the shipment to provisional review (the committer applies that). See
 * cobalt-master-data-governance.
 */
export interface GuardInput {
  vendorCode: string | null
  vendorId: string | null
  forwarderId: string | null
  /** forwarderIdByName(vendorCode) — does the vendor_code itself match a forwarder master/alias? */
  forwarderIdForVendorCode: string | null
  /** approved master_resolution keys as `${kind}:${LHS_UPPER}` (forwarder_ref / vendor_name_marker). */
  approvedKeys: Set<string>
}

export interface GuardResult {
  vendorId: string | null
  forwarderId: string | null
  misclassified: boolean
  reasons: string[]
}

/** Notification/e-invoicing platforms whose identity is NEVER the freight forwarder — the CVP portal's
 *  sender leaks into parsed forwarder_name, and a synced forwarder master row (TRADELINK, code 603)
 *  makes it resolve and link. Defense in depth behind the parser-side scrub (validate rule 4c). */
const PLATFORM_NOT_FORWARDER: RegExp[] = [/TRADE\s*LINK\s*(TECHNOLOGIES|ONE)/i, /TRADELINKONE\.COM/i]

export function isPlatformNotForwarder(name: string | null | undefined): boolean {
  return !!name && PLATFORM_NOT_FORWARDER.some((re) => re.test(name))
}

export function guardVendorForwarder(input: GuardInput): GuardResult {
  const { vendorCode, vendorId, forwarderId, forwarderIdForVendorCode, approvedKeys } = input
  const unchanged: GuardResult = { vendorId, forwarderId, misclassified: false, reasons: [] }
  if (!vendorCode) return unchanged

  const U = vendorCode.toUpperCase()
  // A curated marker that this code IS a vendor wins over any forwarder-name resemblance.
  if (approvedKeys.has(`vendor_name_marker:${U}`)) return unchanged

  const isForwarderRef = approvedKeys.has(`forwarder_ref:${U}`)
  if (!isForwarderRef && !forwarderIdForVendorCode) return unchanged

  const why = isForwarderRef ? 'curated forwarder_ref fact' : 'a forwarder master/alias'
  return {
    vendorId: null, // never persist a forwarder in the vendor slot
    forwarderId: forwarderId ?? forwarderIdForVendorCode ?? null, // fill empty forwarder slot only
    misclassified: true,
    reasons: [`vendor "${vendorCode}" matches ${why} — not linked as a vendor; routed to review`],
  }
}
