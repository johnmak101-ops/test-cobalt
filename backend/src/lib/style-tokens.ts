/**
 * Shared style-token helpers (zero deps). Used by po-enrichment (pick/union)
 * and purchase-order.repository (upsertPo superset-upgrade) without db↔reconcile
 * import cycles.
 */

/** Normalized token set (upper, trimmed) for set ops. */
export function styleTokenSet(raw: string): Set<string> {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.toUpperCase()),
  )
}

/**
 * True when candidate's token set is a proper superset of existing
 * (more tokens, every existing token present). Used to upgrade PO
 * itemStyleNo without shrinking or replacing with disjoint labels.
 */
export function isStyleTokenSuperset(candidate: string, existing: string): boolean {
  const c = styleTokenSet(candidate)
  const e = styleTokenSet(existing)
  if (c.size <= e.size) return false
  return [...e].every((t) => c.has(t))
}

/**
 * Bare PO refs mis-filed as styles (Customs/HAWB "P028642", "PO28630").
 * Pure digit styles (43079) and PO/style slash pairs (4483262/LKN…) stay —
 * only the P0/PO-prefixed side of a slash pair is garbage.
 */
export function isPoShapedStyleToken(token: string): boolean {
  const t = String(token ?? '')
    .trim()
    .replace(/\s+/g, '')
  if (!t) return true
  return /^P0?\d{4,}$/i.test(t) || /^PO\d{4,}$/i.test(t)
}

/** Drop PO-shaped tokens from a comma list; null if nothing real remains. */
export function scrubPoShapedStyles(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const kept: string[] = []
  for (const entry of s.split(/[,;，]+/).map((x) => x.trim()).filter(Boolean)) {
    const sides = entry
      .split('/')
      .map((x) => x.trim())
      .filter((x) => x && !isPoShapedStyleToken(x))
    if (sides.length) kept.push(sides.join('/'))
  }
  return kept.length ? kept.join(', ') : null
}

/** True when every token is PO-shaped (safe to overwrite with a real style). */
export function isEntirelyPoShapedStyle(raw: string | null | undefined): boolean {
  if (raw == null || !String(raw).trim()) return false
  const parts = String(raw)
    .split(/[,;，/]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  return parts.length > 0 && parts.every(isPoShapedStyleToken)
}

/**
 * Real customer style numbers (C198, PUH26BHALE, 56571/SS26SW022) — not colorway / free-text
 * product names. Used so packing-list 款号 beats later "RED STRIPE" from air-booking forms.
 */
export function isStyleCodeToken(token: string): boolean {
  const t = String(token ?? '').trim()
  if (!t || isPoShapedStyleToken(t)) return false
  // Pure color / English fashion adjectives (air booking "color" column)
  if (/^(RED|BLUE|GREEN|BLACK|WHITE|NAVY|PINK|GREY|GRAY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|CREAM|IVORY|MULTI|STRIPE|STRIPES|CHECK|PLAID|SOLID)\b/i.test(t) &&
      !/[0-9]/.test(t) &&
      t.length <= 24) {
    // "RED STRIPE" — no digits, common color phrase
    if (/^(RED|BLUE|GREEN|BLACK|WHITE|NAVY|PINK|GREY|GRAY|YELLOW|ORANGE|PURPLE|BROWN|BEIGE|CREAM|IVORY|MULTI)(\s+(STRIPE|STRIPES|CHECK|PLAID|SOLID))?$/i.test(t)) {
      return false
    }
  }
  // Pure CJK product description (女装针织长袖套头衫) — no Latin/digit style code
  if (/^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s、，,·\-]+$/u.test(t) && !/[A-Za-z0-9]/.test(t)) {
    return false
  }
  // Style-code shapes: letter+digit, digit+letter, C###, slash pairs with alnum
  if (/^[A-Z]{1,6}\d{2,}[A-Z0-9\-\/]*$/i.test(t)) return true // C198, PUH26BHALE, C031AD13
  if (/^\d{3,}[A-Z][A-Z0-9\-\/]*$/i.test(t)) return true
  if (/^[A-Z0-9]{2,}\/[A-Z0-9]{2,}/i.test(t)) return true // 56571/SS26SW022
  if (/\d/.test(t) && /[A-Za-z]/.test(t) && t.length >= 3 && t.length <= 32) return true
  // Pure multi-digit article (106454) often used as style on customs
  if (/^\d{4,8}$/.test(t)) return true
  return false
}

/** True when the whole comma-list is only weak labels (color / CJK description). */
export function isWeakStyleLabel(raw: string | null | undefined): boolean {
  if (raw == null || !String(raw).trim()) return true
  const parts = String(raw)
    .split(/[,;，]+/)
    .map((x) => x.trim())
    .filter(Boolean)
  if (!parts.length) return true
  return parts.every((p) => !isStyleCodeToken(p))
}

/** Prefer lists that contain at least one style-code token when mixed with weak labels. */
export function preferStyleCodeCandidates(styles: string[]): string[] {
  const withCode = styles.filter((s) => !isWeakStyleLabel(s))
  return withCode.length ? withCode : styles
}
