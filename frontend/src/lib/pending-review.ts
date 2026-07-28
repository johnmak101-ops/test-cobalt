import { mapCriticFieldToColumn, conflictColumns } from './review-fields'
import { isQtySettled } from './qty-conflict-settle'
import { isMailboxPartyName, isSameCompanyName, mastersNaming } from './party-names'

/**
 * The slice of the shipment detail this derivation reads. Structural on purpose — importing
 * ShipmentDetail from hooks/ would point a lib module at the data layer.
 */
export interface PendingReviewSource {
  reviewStatus?: string | null
  reviewReasons?: string[]
  criticReview?: { conflicts?: Array<{ field: string }> } | null
  /**
   * The backend's answer to "what is actually still open" (presentation/open-decisions.ts). The
   * review desk drops settled conflicts from its grid; without reading the same list this page kept
   * marking them, so a field could carry an amber "resolve this in the review queue" while the review
   * queue had nothing to say about it. One source, both surfaces.
   */
  openDecisions?: {
    settledFields?: string[]
    /** Party slots linked to a real master — a "not in Mesh" line naming one is stale. */
    resolvedParties?: { slot: string; name: string }[]
  } | null
  contestedLocks?: Array<{ field: string }> | null
  /** Raw party twin names a different company than the resolved master ("flag, don't follow"). */
  customerMismatch?: PartyMismatchLike | null
  vendorMismatch?: PartyMismatchLike | null
}

export type PartyMismatchLike = { raw: string; masterCode: string; masterName: string }

/**
 * Reasons that state a genuine disagreement. reviewReasons also carries system-decision notes
 * ("ETD set to departure date …") whose prose names columns; parsing those would amber-light a
 * field nobody has a question about, so only conflict-flavoured reasons feed conflictColumns.
 */
const CONFLICT_REASON_RE = /conflict|disagree|differ|already stored on|locked field/i

/**
 * Leg columns with something OPEN against them, for the Order Details word-highlight
 * (.review-pending-value): the union of
 *   - critic conflicts while the shipment is still provisional (approving/dismissing the review
 *     item flips reviewStatus, so the highlight clears itself), and
 *   - contested locks, which stay until Keep/Restore regardless of review status.
 * Unknown critic fields are dropped, not invented — same rule as mapCriticFieldsToColumns.
 */
/** Per-column marker for the Order Details rows: 'warn' = open review question (yellow icon),
 *  'miss' = master miss — party/port not in Mesh (red icon, outranks warn). Messages feed the
 *  icon's hover tooltip. The row always shows what the leg STORES; the marker says it is unresolved.
 *  (The `mask` that used to substitute a pre-write value is gone — see pendingReviewAnnotations.) */
export type PendingAnnotation = {
  level: 'warn' | 'miss'
  messages: string[]
}

/**
 * A reason scoped to a PURCHASE ORDER, not to this leg's own columns.
 *
 * `conflictColumns()` finds columns by scanning a reason for column-shaped tokens, so
 * `PO 1570988: qty conflict 3 pieces vs 207 cartons … across legs — order total left unset` matched
 * the word "qty" and amber-lit the LEG's Total Quantity. That reason is about the ORDER's total
 * across every leg it ships on — nothing about this shipment's own 3 cartons is in question, and the
 * review desk correctly carried no item for it, so Order Details was the only surface claiming a
 * problem. Order-level notes belong to the PO, not to the leg's cargo field.
 */
function isPoScopedReason(r: string): boolean {
  return /^\s*PO\s+\S+\s*:/i.test(r)
}

const MESH_MISS_RE =
  /did not exact(?:\/curated)?-match a (?:port )?master|not found in Mesh Database|Cannot match "[^"]+" in the (?:forwarder|customer|vendor|consignee) list|not in UN\/LOCODE masters/i

const LIST_COLUMN: Record<string, string> = {
  forwarder: 'forwarderRaw',
  vendor: 'vendorRaw',
  customer: 'customerRaw',
  consignee: 'consigneeName',
}

/** Field token a mesh-miss reason starts with ("forwarder_name \"LOGWIN\" did not…") → column. */
function missColumn(reason: string): string | null {
  const token = reason.match(/^([a-z_]+)\s+"/i)?.[1]
  if (token) return mapCriticFieldToColumn(token)
  /**
   * The queue's own phrasing names the list it searched — `Cannot match "…" in the vendor list`.
   * Read that BEFORE the loose keyword scan below: the scan tests /forwarder/ first, so any reason
   * that merely mentioned a forwarder anywhere in its sentence was filed under Forwarder, which is
   * how "SOUTH OCEAN KNITTERS LIMITED" (a vendor) ended up hanging off the Forwarder row.
   */
  const list = reason.match(/in the (forwarder|vendor|customer|consignee) list/i)?.[1]
  if (list) return LIST_COLUMN[list.toLowerCase()] ?? null
  if (/forwarder/i.test(reason)) return 'forwarderRaw'
  if (/vendor|factory/i.test(reason)) return 'vendorRaw'
  if (/customer/i.test(reason)) return 'customerRaw'
  if (/consignee/i.test(reason)) return 'consigneeName'
  if (/\bpol\b/i.test(reason)) return 'polRaw'
  if (/\bpod\b|port/i.test(reason)) return 'podRaw'
  return null
}

/** Party slots the backend reports as linked to a real master — their "not in Mesh" is stale. */
const SLOT_COLUMN: Record<string, string> = {
  customer: 'customerRaw',
  vendor: 'vendorRaw',
  forwarder: 'forwarderRaw',
}

/** Committer prose → an operator instruction (ops 2026-07-24: tooltips must say what to DO —
 *  "per-PO qty dropped" reads as system internals; "Please verify" is the ask). */
function humanizeWarnReason(r: string): string {
  // Operators only ever see the TOTAL quantity — per-PO figures, db column names, and merge
  // internals are LLM bookkeeping and must not reach a tooltip (ops 2026-07-24: "make it
  // simple", "now leaking db fields"). The icon already sits ON the field, so a generic line
  // beats naming columns.
  const units = r.match(/conflicting units \(([^)]+)\)/i)?.[1]
  if (units) {
    return `Emails state this quantity in different units (${units}) — please verify.`
  }
  const total = r.match(/preferred document shipment total\s+([^\s(]+)/i)?.[1]
  if (total) {
    return `Total taken from the email's stated figure (${total}) — please verify.`
  }
  const du = r.match(/unit differs:\s*shipped in (\w+), ordered in (\w+)/i)
  if (du) {
    return `Shipped in ${du[1]} but the order says ${du[2]} — please verify.`
  }
  if (/backend conflict on /i.test(r)) {
    return 'This email and the system disagree here — please verify.'
  }
  if (/locked field/i.test(r)) {
    return 'A newer email wants to change this human-locked value — please verify.'
  }
  const stripped = r
    .replace(/^PO \d+:\s*/i, '')
    .replace(/^[a-z][a-z0-9_]*:\s*/, '')
    .trim()
  return /verify/i.test(stripped) ? stripped : `${stripped} — please verify.`
}

/** Column → annotation for the detail rows (see PendingAnnotation). Same sources as
 *  pendingReviewColumns, plus master misses (criticReview.masterMisses + mesh reasons). */
export function pendingReviewAnnotations(
  shipment:
    | (PendingReviewSource & {
        criticReview?: {
          confidence?: { band?: string }
          conflicts?: Array<{
            field: string
            label?: string
            rationale?: string
            candidates?: Array<{
              value: string
              source: string
              master?: { code: string; name: string } | null
            }>
          }>
          masterMisses?: Array<{ type: string; rawName: string; field: string }>
        } | null
        contestedLocks?: Array<{ field: string; yourValue?: string | null; newValue?: string | null }> | null
        humanLockedFields?: string[]
      })
    | null
    | undefined,
  /**
   * The same cargo figures the review desk settles qty against (qty-conflict-settle.ts). A qty
   * conflict the desk drops as settled must not be marked here — "auto-passed" means there is no
   * question, on either surface.
   */
  qtyCtx: { liveQty: number | null; poShipmentTotal: number | null } = {
    liveQty: null,
    poShipmentTotal: null,
  },
  /**
   * Every party master NAME the Mesh mirror holds (customers + vendors + forwarders, flat).
   *
   * Needed to tell "this company is not in Mesh" apart from "this company is in Mesh five times
   * under longer names" — two situations that produced the same sentence, and whose correct
   * operator actions are opposites. Optional: callers without the mirror loaded keep the old
   * behaviour rather than blocking on it.
   */
  masterNames: string[] = [],
): Map<string, PendingAnnotation> {
  const out = new Map<string, PendingAnnotation>()
  if (!shipment) return out
  const add = (col: string | null, level: 'warn' | 'miss', msg: string) => {
    if (!col) return
    const cur = out.get(col)
    if (!cur) out.set(col, { level, messages: [msg] })
    else {
      if (!cur.messages.includes(msg)) cur.messages.push(msg)
      if (level === 'miss') cur.level = 'miss'
    }
  }
  if (shipment.reviewStatus === 'provisional') {
    // Settled conflicts are gone from the review desk, so they must be gone from here too — else the
    // row says "resolve in the review queue" about something the queue has already dropped.
    const settled = new Set(shipment.openDecisions?.settledFields ?? [])
    /**
     * The same list as COLUMNS, because the reason strings below name columns rather than critic
     * fields — and they restate the very conflicts above. Leg 202601256B carried
     * `backend conflict on qty, qty_unit` while BOTH were settled: the desk showed
     * "2 fields … already on the shipment — nothing to apply" and Order Details amber-lit Total
     * Quantity and UOM off the leftover prose.
     */
    const settledCols = new Set(
      [...settled].map((f) => mapCriticFieldToColumn(f)).filter((c): c is string => !!c),
    )
    /**
     * Party slots the backend reports as LINKED to a real master. Their "not in Mesh" is history: an
     * earlier email spelled the company differently ("SOUTH OCEAN KNITTERS LIMITED" vs the master's
     * "…LTD"), the matcher could not exact-match it and said so, and a later pass resolved the slot
     * anyway. The review desk already drops these (dropResolvedPartyMiss); Order Details did not, so
     * it told the operator to add a company that has been in Mesh all along.
     */
    const resolvedCols = new Set(
      (shipment.openDecisions?.resolvedParties ?? [])
        .map((p) => SLOT_COLUMN[String(p.slot ?? '').toLowerCase()])
        .filter((c): c is string => !!c),
    )
    /**
     * The master NAMES this leg resolved, on any slot. `resolvedParties` has carried them all along
     * ("a miss line naming one is stale", open-decisions.ts) and both surfaces read only the slot.
     *
     * Leg 202601DD8E is what that cost: `SOUTH OCEAN KNITTERS LIMITED` hung off the Forwarder row as
     * "not found in Mesh Database — advise add in Mesh" while the leg's VENDOR was linked to
     * `SOUTH OCEAN KNITTERS LTD`. Same company, in Mesh throughout, filed against the wrong slot
     * upstream — and the advice, if followed, creates a second master for a factory under the
     * forwarder type. Matching by name kills it wherever the queue filed it.
     */
    const resolvedNames = (shipment.openDecisions?.resolvedParties ?? [])
      .map((p) => String(p.name ?? '').trim())
      .filter(Boolean)
    /**
     * The masters that ARE this company, when the raw name is not one of them exactly.
     *
     * "did not exact-match a master" is a true statement about the lookup and a false one about
     * Mesh. Leg S2600144827 carries `forwarder_name "LOGWIN"`, and Mesh holds FIVE LOGWIN
     * companies — Shenzhen, Guangzhou, Hong Kong, two more — none of them named just "LOGWIN". The
     * row therefore said "not found in Mesh Database — advise add in Mesh", and an operator who
     * followed that advice would create a sixth.
     *
     * So the icon stays — the leg genuinely has no forwarder linked, and which LOGWIN branch this
     * shipment used is a real question with a real answer — but the ADVICE inverts: not "add this
     * company", "you have five of them, say which". `isSameCompanyName` is the same predicate the
     * resolved-name rule above uses; it already treats `LOGWIN` and `LOGWIN AIR & OCEAN HONG KONG
     * LTD` as one company, and it is deliberately a prefix/stem test rather than a fuzzy score, so
     * a genuinely absent company still reads as absent and still says "add in Mesh".
     *
     * Kind-agnostic on purpose, exactly as `resolvedNames` is: the queue files misses against the
     * wrong slot often enough (leg 202601DD8E put a VENDOR under Forwarder) that trusting the slot
     * here would reintroduce the bug that rule exists to kill.
     */
    const addMiss = (col: string | null, msg: string, name?: string | null) => {
      if (col && resolvedCols.has(col)) return
      if (name && resolvedNames.some((n) => isSameCompanyName(name, n))) return
      if (name) {
        const hits = mastersNaming(name, masterNames)
        if (hits.length) {
          const shown = hits.slice(0, 3).join(', ')
          const more = hits.length > 3 ? `, +${hits.length - 3} more` : ''
          // 'warn', not 'miss'. A master MISS means the company is absent from Mesh and someone must
          // add it — the red icon and the "Master Miss" heading both say so. Here Mesh has the
          // company, five times over; what is unresolved is WHICH, and that is an open review
          // question like any other. Filing it as a miss put the same falsehood in the heading that
          // the body text was written to remove.
          add(
            col,
            'warn',
            hits.length === 1
              ? `"${name}" is in Mesh as ${hits[0]} — not linked yet. Edit the field and pick it.`
              : `"${name}" matches ${hits.length} companies in Mesh but names none of them exactly — pick the right one (${shown}${more}).`,
          )
          return
        }
      }
      add(col, 'miss', msg)
    }
    for (const c of shipment.criticReview?.conflicts ?? []) {
      if (settled.has(c.field)) continue
      // qty settles against the leg's shipped figure / the PO shipment total, not by value equality —
      // the desk's own rule, so both surfaces reach the same verdict.
      if (isQtySettled(c as Parameters<typeof isQtySettled>[0], qtyCtx)) continue
      add(
        mapCriticFieldToColumn(c.field),
        'warn',
        c.rationale?.trim()
          ? humanizeWarnReason(c.rationale.trim())
          : 'Values disagree across emails — resolve in the review queue.',
      )
    }
    /**
     * The unconfirmed-answer MASK is gone (2026-07-27).
     *
     * It displayed the critic's `System` candidate in place of what the leg stores, so that an
     * unconfirmed commit-first write would not be asserted as fact. Two things were wrong with it.
     *
     * The `prior` it fell back to came from the same pre-commit snapshot that produced the
     * "Leave Blank over a stored MACFUN" bug: the queue emits a System candidate only for
     * backendMismatches, so party rows have none, `prior` was null, and the row printed "(pending)"
     * — asserting the field is EMPTY, which is a bigger falsehood than the value it was avoiding.
     *
     * And it put two surfaces in disagreement about one field: leg 202601DD8E read
     * "ROKNFT (on shipment)" in the review card and "(pending)" in Order Details at the same moment.
     * An operator cannot reconcile that, and "which page is lying?" is not a question this app
     * should raise.
     *
     * What replaces it is what was already there: the row keeps its amber `.review-pending-value`
     * highlight and its warning icon, whose tooltip says the value is unresolved and where to settle
     * it. The value is shown, and shown as unconfirmed — rather than hidden and mis-stated.
     */
    for (const r of shipment.reviewReasons ?? []) {
      // Same wording as the review queue's Needs Attention line — the raw reason ("forwarder_name
      // "LOGIMARK" did not exact-match a master (LLM matcher owns fuzzy; left unlinked)") is too
      // long to read in a tooltip (ops 2026-07-24).
      if (MESH_MISS_RE.test(r)) {
        const name = r.match(/"([^"]+)"/)?.[1]
        // A "party" with no letter in any script is a leaked PO/booking/container number, not a
        // company — "advise add in Mesh" is unactionable for it, so no icon at all. Twin of
        // isNonPartyName (needs-attention.ts / backend critic-review.types.ts) — keep in step.
        if (name && !/\p{L}/u.test(name)) continue
        // …and a mailbox is not a company either. Same shared rule the review desk applies, so the
        // two surfaces name the same parties and count the same number of them.
        if (name && isMailboxPartyName(name)) continue
        addMiss(
          missColumn(r),
          name
            ? `"${name}" not found in Mesh Database — advise add in Mesh.`
            : 'Not found in Mesh Database — advise add in Mesh.',
          name,
        )
      }
      else if (CONFLICT_REASON_RE.test(r) && !isPoScopedReason(r))
        for (const col of conflictColumns([r])) {
          if (settledCols.has(col)) continue // the desk already dropped this one
          add(col, 'warn', humanizeWarnReason(r))
        }
    }
    for (const m of shipment.criticReview?.masterMisses ?? []) {
      if (!/\p{L}/u.test(m.rawName ?? '')) continue // numeric leak — see the comment above
      if (isMailboxPartyName(m.rawName)) continue // mailbox, not a company — see the comment above
      addMiss(
        mapCriticFieldToColumn(m.field) ?? missColumn(m.field + ' "x"'),
        `"${m.rawName}" not found in Mesh Database — advise add in Mesh.`,
        m.rawName,
      )
    }
  }
  for (const lock of shipment.contestedLocks ?? []) {
    add(
      mapCriticFieldToColumn(lock.field) ?? lock.field,
      'warn',
      `A newer email changed your edit (${lock.yourValue ?? '—'} → ${lock.newValue ?? '—'}) — keep or restore below.`,
    )
  }
  // "Flag, don't follow" (2026-07-24): an agent raw-party write never moves the resolved master, so
  // when they diverge the master keeps display and this amber says so. Outside the provisional gate —
  // the divergence persists after confirm, unlike open review questions.
  for (const [col, m] of [
    ['customerRaw', shipment.customerMismatch],
    ['vendorRaw', shipment.vendorMismatch],
  ] as const) {
    if (!m) continue
    add(
      col,
      'warn',
      `Emails say "${m.raw}" but the resolved master ${m.masterCode} — ${m.masterName} — is kept for display. Edit here or correct in review if wrong.`,
    )
  }
  return out
}

export function pendingReviewColumns(
  shipment: PendingReviewSource | null | undefined,
): Set<string> {
  const cols = new Set<string>()
  if (!shipment) return cols
  if (shipment.reviewStatus === 'provisional') {
    for (const c of shipment.criticReview?.conflicts ?? []) {
      const col = mapCriticFieldToColumn(c.field)
      if (col) cols.add(col)
    }
    const conflictReasons = (shipment.reviewReasons ?? []).filter((r) =>
      CONFLICT_REASON_RE.test(r),
    )
    for (const col of conflictColumns(conflictReasons)) cols.add(col)
  }
  for (const lock of shipment.contestedLocks ?? []) {
    cols.add(mapCriticFieldToColumn(lock.field) ?? lock.field)
  }
  return cols
}
