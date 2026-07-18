/**
 * Drop port "Cannot match / not in UN/LOCODE" review reasons when the leg already has a linked port.
 * Failed synonym tokens (e.g. country "FRANCE") must not flag after pol/pod auto-matched (e.g. FRLEH).
 */

export function isPortMasterMissReason(reason: string): boolean {
  const r = reason.trim()
  if (!r) return false
  return (
    /as a port\b/i.test(r) ||
    /UN\/LOCODE/i.test(r) ||
    /did not exact(?:\/curated)?-match a port master/i.test(r) ||
    /^Port\s+"/i.test(r) ||
    (/not in master data/i.test(r) && /raw value kept/i.test(r))
  )
}

/**
 * @param polLinked - shipment has pol_id (or resolved pol master)
 * @param podLinked - shipment has pod_id (or resolved pod master)
 */
export function filterPortMissReasons(
  reasons: string[],
  opts: { polLinked: boolean; podLinked: boolean },
): string[] {
  const { polLinked, podLinked } = opts
  if (!polLinked && !podLinked) return reasons
  return reasons.filter((reason) => {
    if (!isPortMasterMissReason(reason)) return true
    // Field-specific committer copy
    if (/^pol\s+"/i.test(reason)) return !polLinked
    if (/^pod\s+"/i.test(reason)) return !podLinked
    // Generic "Cannot match X as a port" / UN/LOCODE — suppress when that side (or both) is linked.
    // When both ports linked, any residual port-fail token is stale synonym noise.
    if (polLinked && podLinked) return false
    // Single side linked: still drop generic port-cannot-match (cannot attribute side from copy alone
    // once LOCODE is on the leg — user rule: matched automatically → do not flag).
    if (polLinked || podLinked) return false
    return true
  })
}
