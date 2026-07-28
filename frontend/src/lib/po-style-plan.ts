/**
 * What a PO's style list will become, from what the operator ticked.
 *
 * The review desk composes the list from two columns of boxes: every style the PO already holds
 * (ticked = keep) and the one the emails offered (ticked = add). The result is whatever is ticked —
 * which makes "drop the junk someone typed in" and "take the style off the packing list" the same
 * gesture, instead of one being a checkbox and the other a trip through Edit.
 *
 * Pure, and separate from the component, because this is the part that must be right: it decides what
 * gets WRITTEN to a PO master. The component decides what it looks like.
 */

/** Style lists are comma-separated in storage; CJK commas and semicolons appear in pasted values. */
export function styleTokens(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(/[,;，]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** What the operator has ticked for one PO. Absent entries mean "untouched", i.e. every existing
 *  token kept and nothing added — so a PO nobody has touched needs no entry at all. */
export interface PoStyleSelection {
  /** Existing tokens UNTICKED, i.e. to be dropped. Compared case-insensitively. */
  dropped?: string[]
  /** The "Also Seen In Email" value is ticked, i.e. to be appended. */
  added?: boolean
}

export interface PoStylePlan {
  poId: string
  poNumber: string
  /** The whole list to write. Empty string = the PO's styles are being cleared. */
  itemStyleNo: string
  /** True when the write empties the field — the one outcome that destroys data. */
  clears: boolean
}

const norm = (t: string): string => t.trim().toUpperCase()

/**
 * The list a PO will hold, given what is ticked. Returns null when nothing changes.
 *
 * ADD, never replace: the ticked value is appended to the kept tokens rather than swapping the list.
 * That matches `upsertPo`'s own never-shrink rule on the agent path — a style list is a set of things
 * this PO covers, not a single value with one right answer — and it means taking a value can only
 * ever lose a token the operator explicitly unticked.
 *
 * Duplicates are dropped on the way in: `alsoSeenStyleForPo` already refuses to offer a value the PO
 * carries, but the operator can untick the token that made it a duplicate and re-tick it here, and
 * the list must not end up holding it twice.
 */
export function planForPo(
  po: { id: string; poNumber: string; itemStyleNo?: string | null },
  alsoSeen: string | null,
  selection: PoStyleSelection | undefined,
): PoStylePlan | null {
  const existing = styleTokens(po.itemStyleNo)
  const dropped = new Set((selection?.dropped ?? []).map(norm))
  const kept = existing.filter((t) => !dropped.has(norm(t)))

  const out = [...kept]
  if (selection?.added && alsoSeen) {
    const seen = new Set(out.map(norm))
    for (const t of styleTokens(alsoSeen)) {
      if (!seen.has(norm(t))) {
        out.push(t)
        seen.add(norm(t))
      }
    }
  }

  const itemStyleNo = out.join(', ')
  // Compare against the STORED string, not the token list: re-joining an unchanged list can
  // normalise spacing ("A,B" → "A, B"), and writing a PO to reformat it is not a change the
  // operator asked for — it would put the leg in the audit trail for nothing.
  if (itemStyleNo === styleTokens(po.itemStyleNo).join(', ')) return null

  return { poId: po.id, poNumber: po.poNumber, itemStyleNo, clears: out.length === 0 }
}

/** Every PO whose list would change. The card's change count adds this length to its field count. */
export function planAll(
  pos: { id: string; poNumber: string; itemStyleNo?: string | null }[],
  alsoSeenFor: (po: { poNumber: string; itemStyleNo?: string | null }) => string | null,
  selections: Record<string, PoStyleSelection>,
): PoStylePlan[] {
  const out: PoStylePlan[] = []
  for (const po of pos) {
    const plan = planForPo(po, alsoSeenFor(po), selections[po.id])
    if (plan) out.push(plan)
  }
  return out
}
