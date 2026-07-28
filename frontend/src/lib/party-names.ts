/**
 * Shared tests for "is this string actually a company?", used by every surface that offers a party
 * name to ops as addable in Mesh.
 *
 * These live in one module on purpose. The rule used to be defined next to the review desk and
 * merely DESCRIBED next to the shipment detail page ("Twin of … — keep in step"), and the twins
 * drifted: leg 2026058AA7 listed three names under Forwarder — Master Miss on the detail page while
 * the desk counted two, because the mailbox rule below had only ever been added to the desk.
 * A second definition is a second thing to forget.
 */

/**
 * A "party" that is really a mail header rather than a company:
 *   Maersk Global Service Center (Chengdu) <noreply-gca@lns.maersk.com>
 * or a bare address.
 *
 * Master miss tells ops to "add in Mesh", and creating a master named after a no-reply mailbox would
 * pollute the very data the advice exists to fix. Seen on live leg A84B3B1A, where the desk asked ops
 * to add a Maersk service-centre mailbox to the forwarder list.
 */
export function isMailboxPartyName(raw: string | null | undefined): boolean {
  return /[^\s@]+@[^\s@]+\.[^\s@]{2,}/.test(String(raw ?? ''))
}

/** Strip everything but letters and digits — "Land's End" and "LANDS END" are one company. */
function companyKey(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Legal forms only — the words that say what a company IS, not which company it is. `GROUP` and
 * `HOLDINGS` are deliberately absent: they distinguish real entities, and folding them would make
 * a parent and its subsidiary look like one master.
 */
const LEGAL_SUFFIXES = new Set([
  'LIMITED', 'LTD', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'INC', 'INCORPORATED',
  'LLC', 'LLP', 'PLC', 'GMBH', 'AG', 'KG', 'BV', 'NV', 'SA', 'SAS', 'SRL',
  'PTE', 'PVT', 'SDN', 'BHD',
])

/** The name with trailing legal forms removed: `SOUTH OCEAN KNITTERS LTD` → `SOUTHOCEANKNITTERS`. */
function companyStem(s: string): string {
  const words = String(s ?? '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop()
  return words.join('')
}

/** x is y, or the shorter is how the longer begins. Floored at 4 so short codes cannot collide. */
function prefixMatch(x: string, y: string): boolean {
  if (!x || !y) return false
  if (x === y) return true
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  return short.length >= 4 && long.startsWith(short)
}

/**
 * The same company written shorter or longer: `WHISTLES` vs `WHISTLES LIMITED`, `Land's End` vs
 * `LANDS END EUROPE LIMITED`. A prefix relation, floored at 4 characters so short codes cannot
 * collide by accident.
 *
 * The prefix alone cannot see through a SUBSTITUTED legal form, only a dropped one:
 * `SOUTH OCEAN KNITTERS LIMITED` and `SOUTH OCEAN KNITTERS LTD` diverge at character 19, so the
 * leg whose vendor master IS that company still read as a company nobody had ever heard of. So the
 * comparison is tried again on the stems, with trailing legal forms removed from both.
 *
 * Deliberately NOT a fuzzy score. It has one job — decide whether a miss line describes a company
 * the leg already resolved — and it must say no for a genuinely different entity. `Ligentia China
 * Ltd.` against a linked `LIGENTIA ASIA LTD` is not a prefix either way, stems included, so that
 * line correctly survives.
 */
export function isSameCompanyName(a: string | null | undefined, b: string | null | undefined): boolean {
  return prefixMatch(companyKey(a ?? ''), companyKey(b ?? '')) ||
    prefixMatch(companyStem(a ?? ''), companyStem(b ?? ''))
}
