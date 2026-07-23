/**
 * Sender-header display helpers.
 *
 * Pure string work, kept out of EmailContent.tsx so the review card, the shipment detail page and
 * the thread list can render a sender without importing an entire reader component.
 *
 * DISPLAY ONLY — the stored `sender` column is the header exactly as received and is never
 * rewritten. Matching, dedupe and the learning feed all keep reading the raw value.
 */

/**
 * Legacy Exchange X500 Distinguished Name, e.g.
 *   /O=EXCHANGELABS/OU=EXCHANGE ADMINISTRATIVE GROUP (FYDIBOHF23SPDLT)/CN=RECIPIENTS/CN=<guid>-RICKY HE
 *
 * Outlook writes this instead of an SMTP address when the sender is INTERNAL to the tenant, and a
 * .msg export keeps it verbatim — so a Cobalt thread shows 125 characters of directory path where a
 * person's name belongs. The readable name is the tail of the LAST CN= segment, after the address
 * book's 32-hex GUID.
 */
export function nameFromExchangeDn(raw: string): string | null {
  if (!/^\/O=/i.test(raw)) return null
  const lastCn = raw.split(/\/CN=/i).pop()?.trim()
  if (!lastCn) return null
  // <32-hex guid>-DISPLAY NAME → DISPLAY NAME. Some tenants use a plain alias with no guid prefix.
  const withGuid = lastCn.match(/^[0-9A-F]{16,}-(.+)$/i)
  const name = (withGuid ? withGuid[1] : lastCn).trim()
  // 'RECIPIENTS' is a container segment, not a person — a DN ending there names nobody, so fall
  // through to the raw value rather than labelling every internal sender "Recipients".
  if (!name || /^recipients$/i.test(name)) return null
  return name
}

/**
 * "Display Name <addr@x.com>" → { name, addr }; also unwraps an Exchange DN to the person's name.
 * Accepts null/undefined because several list rows carry a nullable sender — the body already
 * coalesced, so the signature just stops callers having to.
 */
export function parseSender(raw: string | null | undefined): { name: string; addr: string } {
  const m = (raw ?? '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: (m[1] || m[2]).trim(), addr: m[2].trim() }
  const t = (raw ?? '').trim()
  const dn = nameFromExchangeDn(t)
  // addr stays empty for a DN: it is not an address, and presenting it as one invites a mailto
  // link that can never deliver.
  if (dn) return { name: dn, addr: '' }
  return { name: t || 'Unknown sender', addr: t.includes('@') ? t : '' }
}
