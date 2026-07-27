import { describe, it, expect } from 'vitest'
import { pendingReviewColumns, pendingReviewAnnotations } from './pending-review'

const critic = (fields: string[]) => ({ conflicts: fields.map((field) => ({ field })) })

describe('pendingReviewColumns — which Order Details columns carry something open for review', () => {
  it('maps provisional critic conflicts to leg columns (snake_case parser names included)', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      criticReview: critic(['etd', 'qty_unit', 'hbl_awb_fcr_no', 'booking_no']),
    })
    expect(cols).toEqual(new Set(['etd', 'qtyUnit', 'hblAwbFcrNo', 'bookingNo']))
  })

  it('drops critic fields that map to no leg column instead of inventing one', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      criticReview: critic(['customer_po', 'totally_unknown_field']),
    })
    expect(cols.size).toBe(0)
  })

  it('ignores critic conflicts once the review is no longer provisional', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'confirmed',
      criticReview: critic(['etd']),
    })
    expect(cols.size).toBe(0)
  })

  it('always includes contested locks, even after approval', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'confirmed',
      contestedLocks: [{ field: 'etd' }, { field: 'qtyUnit' }],
    })
    expect(cols).toEqual(new Set(['etd', 'qtyUnit']))
  })

  it('parses conflict-flavoured review reasons into columns (Order Details vocabulary only)', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      reviewReasons: ['backend conflict on qty, gross_weight, measurement'],
    })
    // gross_weight / measurement are not on the Order Details form — never highlighted there.
    expect(cols).toEqual(new Set(['qty']))
  })

  it('does not light fields from system-decision notes that merely mention a column', () => {
    const cols = pendingReviewColumns({
      reviewStatus: 'provisional',
      reviewReasons: ['ETD set to departure date 2026-02-08 (booking estimate was 2026-02-06)'],
    })
    expect(cols.size).toBe(0)
  })

  it('returns an empty set for a missing shipment', () => {
    expect(pendingReviewColumns(undefined).size).toBe(0)
    expect(pendingReviewColumns(null).size).toBe(0)
  })
})

describe('pendingReviewAnnotations — warn tooltips read as operator instructions', () => {
  it('humanizes a units conflict into a "please verify" line', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [
        'qty 3 stated under conflicting units (cartons vs packages vs pieces) — per-PO qty dropped',
      ],
    })
    expect(ann.get('qty')?.level).toBe('warn')
    expect(ann.get('qty')?.messages[0]).toBe(
      'Emails state this quantity in different units (cartons vs packages vs pieces) — please verify.',
    )
  })

  /**
   * A `PO nnn: …` reason is about the ORDER across every leg it ships on, not about this leg's cargo
   * field. `conflictColumns()` finds columns by scanning for column-shaped tokens, so the word "qty"
   * inside one lit up the leg's Total Quantity — leg 202605C7BD showed an amber "Needs Review" on its
   * 3 cartons because a PO's total across 13 legs was unset, while the review desk (correctly) had
   * no item for it at all. Order-level notes belong to the PO.
   */
  it('a PO-scoped reason never marks a leg column', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [
        'PO 1570988: qty conflict 3 pieces vs 207 cartons across legs — order total left unset, confirm the ordered quantity on the customer PO',
      ],
    })
    expect(ann.get('qty')).toBeUndefined()
    expect(ann.size).toBe(0)
  })
})

describe('pendingReviewAnnotations — no DB field names leak into tooltips', () => {
  it('rewrites the document-total rationale (critic conflict) into plain language', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: {
        conflicts: [
          {
            field: 'qty',
            rationale: 'qty: preferred document shipment total 207 (per-PO sum incomplete or absent)',
          },
        ],
      },
    })
    expect(ann.get('qty')?.messages[0]).toBe(
      "Total taken from the email's stated figure (207) — please verify.",
    )
  })
  it('rewrites the shipped-vs-ordered unit reason and strips db-style prefixes generally', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: ['qty_unit conflict — unit differs: shipped in cartons, ordered in pieces'],
    })
    const msgs = [...ann.values()].flatMap((a) => a.messages)
    expect(msgs[0]).toBe('Shipped in cartons but the order says pieces — please verify.')
  })
})

describe('pendingReviewAnnotations — remaining reason families read plainly', () => {
  it('backend conflicts become a generic line (the icon already sits on the field)', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: ['backend conflict on qty, gross_weight, measurement'],
    })
    expect(ann.get('qty')?.messages[0]).toBe(
      'This email and the system disagree here — please verify.',
    )
  })
  it('locked-field clashes become a plain line', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: ['Would change locked field(s): etd'],
    })
    expect(ann.get('etd')?.messages[0]).toBe(
      'A newer email wants to change this human-locked value — please verify.',
    )
  })
})

describe('pendingReviewAnnotations — numeric "parties" never become Mesh-miss icons', () => {
  it('suppresses a quoted all-digit name (a leaked PO/booking number, not a company)', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: ['customer_code "1012485" did not exact-match a master (left unlinked)'],
      criticReview: { masterMisses: [{ type: 'vendor', rawName: '2867408', field: 'vendor_code' }] },
    })
    expect(ann.get('customerRaw')).toBeUndefined()
    expect(ann.get('vendorRaw')).toBeUndefined()
  })
  it('still flags names that contain letters (CJK and letter+digit brands included)', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: { masterMisses: [{ type: 'vendor', rawName: '3M', field: 'vendor_code' }] },
    })
    expect(ann.get('vendorRaw')?.level).toBe('miss')
  })
})

describe("pendingReviewAnnotations — party mismatch (flag, don't follow)", () => {
  it('ambers vendorRaw with the kept-master message', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'confirmed',
      vendorMismatch: { raw: 'SOUOCE', masterCode: 'MACFUN', masterName: 'MACAU FUNG TAI LIMITED' },
    })
    const a = ann.get('vendorRaw')
    expect(a?.level).toBe('warn')
    expect(a?.messages[0]).toContain('SOUOCE')
    expect(a?.messages[0]).toContain('MACFUN')
  })

  it('shows regardless of review status and covers the customer twin', () => {
    const ann = pendingReviewAnnotations({
      customerMismatch: { raw: 'DOCC', masterCode: 'WYSE', masterName: 'WYSE LONDON LIMITED' },
    })
    expect(ann.get('customerRaw')?.level).toBe('warn')
    expect(ann.get('vendorRaw')).toBeUndefined()
  })

  it('a master miss on the same column outranks the mismatch amber', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: { masterMisses: [{ type: 'vendor', rawName: 'NEW KNITTERS', field: 'vendor_code' }] },
      vendorMismatch: { raw: 'NEW KNITTERS', masterCode: 'MACFUN', masterName: 'MACAU FUNG TAI LIMITED' },
    })
    expect(ann.get('vendorRaw')?.level).toBe('miss')
  })
})

describe('pendingReviewAnnotations — the row shows what the leg stores, marked unresolved', () => {
  /**
   * The mask is gone (2026-07-27). It substituted the critic's `System` candidate for the stored
   * value so an unconfirmed commit-first write would not read as fact — but party rows carry no
   * System candidate, so it printed "(pending)" over a real value, and it put Order Details and the
   * review card in disagreement about one field (leg 202601DD8E: "ROKNFT (on shipment)" vs
   * "(pending)"). The annotation now only MARKS the row; the value itself is never replaced.
   */
  it('annotates a conflicted field without proposing a replacement value', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: {
        confidence: { band: 'medium' },
        conflicts: [
          {
            field: 'eta',
            candidates: [
              { value: '2026-07-20', source: 'System' },
              { value: '2026-07-23', source: 'SO' },
            ],
          },
        ],
      },
    })
    expect(ann.get('eta')?.level).toBe('warn')
    expect(ann.get('eta')).not.toHaveProperty('mask')
  })

  it('marks a party row with no System candidate instead of blanking it', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: {
        confidence: { band: 'medium' },
        conflicts: [
          {
            field: 'vendor_code',
            candidates: [
              { value: 'SOUTH OCEAN KNITTERS LTD', source: 'Booking Request' },
              { value: 'ROSE KNITTING FACTORY LIMITED', source: 'SO' },
            ],
          },
        ],
      },
    })
    expect(ann.get('vendorRaw')?.level).toBe('warn')
    expect(ann.get('vendorRaw')).not.toHaveProperty('mask')
  })

  it('a confirmed leg carries no annotation at all', () => {
    const confirmed = pendingReviewAnnotations({
      reviewStatus: 'confirmed',
      criticReview: {
        confidence: { band: 'medium' },
        conflicts: [
          {
            field: 'eta',
            candidates: [
              { value: '2026-07-20', source: 'System' },
              { value: '2026-07-23', source: 'SO' },
            ],
          },
        ],
      },
    })
    expect(confirmed.get('eta')).toBeUndefined()
  })
})

/**
 * One source of truth for "what is still open". The desk drops conflicts the backend reports as
 * settled (openDecisions.settledFields); this page did not read that list, so a settled field kept
 * an amber "resolve in the review queue" marker while the review queue had nothing about it.
 */
describe('pendingReviewAnnotations — settled conflicts are not marked', () => {
  const conflicted = {
    reviewStatus: 'provisional',
    criticReview: {
      confidence: { band: 'medium' },
      conflicts: [
        { field: 'eta', candidates: [{ value: '2026-07-23', source: 'SO' }], rationale: 'test' },
      ],
    },
  }

  it('marks the field while the backend still calls it open', () => {
    expect(pendingReviewAnnotations({ ...conflicted, openDecisions: { settledFields: [] } }).get('eta')?.level).toBe('warn')
  })

  it('drops the marker once the backend reports it settled', () => {
    expect(
      pendingReviewAnnotations({ ...conflicted, openDecisions: { settledFields: ['eta'] } }).get('eta'),
    ).toBeUndefined()
  })

  it('an absent openDecisions leaves every conflict marked — the safe direction', () => {
    expect(pendingReviewAnnotations(conflicted).get('eta')?.level).toBe('warn')
  })
})

/**
 * Leg 202601256B: qty + qty_unit both settled (the desk said "2 fields … already on the shipment —
 * nothing to apply") while `backend conflict on qty, qty_unit` still sat in reviewReasons. The
 * conflicts loop skipped them; the REASON loop re-marked the same two columns off the leftover
 * prose, so Order Details amber-lit Total Quantity and UOM with nothing behind them.
 */
describe('pendingReviewAnnotations — a settled field is not re-marked by leftover reason prose', () => {
  const leg = {
    reviewStatus: 'provisional',
    openDecisions: { settledFields: ['qty', 'qty_unit'] },
    reviewReasons: ['2 field conflict(s)', 'backend conflict on qty, qty_unit'],
    criticReview: {
      confidence: { band: 'low' },
      conflicts: [
        { field: 'qty', candidates: [{ value: '29', source: 'SO' }], rationale: 'x' },
        { field: 'qty_unit', candidates: [{ value: 'cartons', source: 'SO' }], rationale: 'x' },
      ],
    },
  }

  it('marks neither column', () => {
    const ann = pendingReviewAnnotations(leg)
    expect(ann.get('qty')).toBeUndefined()
    expect(ann.get('qtyUnit')).toBeUndefined()
    expect(ann.size).toBe(0)
  })

  it('still marks the same prose when the field is genuinely open', () => {
    const ann = pendingReviewAnnotations({ ...leg, openDecisions: { settledFields: [] } })
    expect(ann.get('qty')?.level).toBe('warn')
    expect(ann.get('qtyUnit')?.level).toBe('warn')
  })
})

/**
 * Leg 202605C7BD: Order Details said "SOUTH OCEAN KNITTERS LIMITED — not in Mesh" while the vendor
 * slot was linked to SOUTH OCEAN KNITTERS **LTD** all along. An earlier email spelled it differently,
 * the matcher could not exact-match and said so, a later pass resolved the slot — and only this page
 * kept repeating the stale complaint. The review desk already drops them (dropResolvedPartyMiss).
 */
describe('pendingReviewAnnotations — a resolved party has no "not in Mesh"', () => {
  const meshMiss = 'Cannot match "SOUTH OCEAN KNITTERS LIMITED" in the vendor list. Please add it in Cobalt Fashion Data Mesh System, then rematch.'

  it('drops the miss once the backend reports that slot linked', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [meshMiss],
      openDecisions: { resolvedParties: [{ slot: 'vendor', name: 'SOUTH OCEAN KNITTERS LTD' }] },
    })
    expect(ann.get('vendorRaw')).toBeUndefined()
  })

  it('keeps it while the slot is genuinely unlinked', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [meshMiss],
      openDecisions: { resolvedParties: [] },
    })
    expect(ann.get('vendorRaw')?.level).toBe('miss')
  })

  it('a resolved vendor does not silence an unresolved forwarder', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [meshMiss, 'forwarder_name "FAIRATE" did not exact-match a master'],
      openDecisions: { resolvedParties: [{ slot: 'vendor', name: 'SOUTH OCEAN KNITTERS LTD' }] },
    })
    expect(ann.get('vendorRaw')).toBeUndefined()
    expect(ann.get('forwarderRaw')?.level).toBe('miss')
  })

  it('also drops a masterMisses entry for the resolved slot', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      openDecisions: { resolvedParties: [{ slot: 'vendor', name: 'SOUTH OCEAN KNITTERS LTD' }] },
      criticReview: {
        masterMisses: [
          // the queue filed this Chinese FORWARDER name against the vendor slot too
          { type: 'vendor', rawName: '鼎赋供应链管理（东莞）有限公司', field: 'vendor_code' },
          { type: 'forwarder', rawName: '鼎赋供应链管理（东莞）有限公司', field: 'forwarder_name' },
        ],
      },
    })
    expect(ann.get('vendorRaw')).toBeUndefined()
    expect(ann.get('forwarderRaw')?.level).toBe('miss')
  })
})

/**
 * The loose keyword scan tested /forwarder/ first, so a vendor miss whose sentence happened to
 * mention a forwarder was filed under the Forwarder row. The queue names the list it searched — read
 * that instead of guessing.
 */
describe('pendingReviewAnnotations — a mesh miss lands on the field it is about', () => {
  it('reads the list the queue says it searched', () => {
    const vendor = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: ['Cannot match "SOUTH OCEAN KNITTERS LIMITED" in the vendor list. Please add it in Cobalt Fashion Data Mesh System, then rematch.'],
    })
    expect(vendor.get('vendorRaw')?.level).toBe('miss')
    expect(vendor.get('forwarderRaw')).toBeUndefined()

    const fwd = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: ['Cannot match "鼎赋供应链管理（东莞）有限公司" in the forwarder list. Please add it in Cobalt Fashion Data Mesh System, then rematch.'],
    })
    expect(fwd.get('forwarderRaw')?.level).toBe('miss')
    expect(fwd.get('vendorRaw')).toBeUndefined()
  })
})
