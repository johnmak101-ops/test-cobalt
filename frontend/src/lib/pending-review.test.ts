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
  it('humanizes the per-PO-dropped units conflict into a "please verify" line', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      reviewReasons: [
        'PO 1570988: qty 3 stated under conflicting units (cartons vs packages vs pieces) — per-PO qty dropped',
      ],
    })
    expect(ann.get('qty')?.level).toBe('warn')
    expect(ann.get('qty')?.messages[0]).toBe(
      'Emails state this quantity in different units (cartons vs packages vs pieces) — please verify.',
    )
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
      reviewReasons: ['PO 1570988: qty_unit conflict — unit differs: shipped in cartons, ordered in pieces'],
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

describe('pendingReviewAnnotations — unconfirmed answers mask the display (commit-first, display-second)', () => {
  it('masks a conflicted field back to the prior System value', () => {
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
    expect(ann.get('eta')?.mask).toEqual({ prior: '2026-07-20' })
  })

  it('masks to (pending) when there was no prior value', () => {
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
    expect(ann.get('vendorRaw')?.mask).toEqual({ prior: null })
  })

  it('prefers the master CODE for the party prior (the row is labelled Vendor Code)', () => {
    const ann = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: {
        confidence: { band: 'medium' },
        conflicts: [
          {
            field: 'vendor_code',
            candidates: [
              {
                value: 'MACAU FUNG TAI LIMITED',
                source: 'System',
                master: { code: 'MACFUN', name: 'MACAU FUNG TAI LIMITED' },
              },
              { value: 'ROSE KNITTING FACTORY LIMITED', source: 'SO' },
            ],
          },
        ],
      },
    })
    expect(ann.get('vendorRaw')?.mask).toEqual({ prior: 'MACFUN' })
  })

  it('never masks high band or human-locked fields (manual edits stay firm)', () => {
    const conflicts = [
      {
        field: 'eta',
        candidates: [
          { value: '2026-07-20', source: 'System' },
          { value: '2026-07-23', source: 'SO' },
        ],
      },
    ]
    const high = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: { confidence: { band: 'high' }, conflicts },
    })
    expect(high.get('eta')?.mask).toBeUndefined()
    const locked = pendingReviewAnnotations({
      reviewStatus: 'provisional',
      criticReview: { confidence: { band: 'medium' }, conflicts },
      humanLockedFields: ['eta'],
    })
    expect(locked.get('eta')?.mask).toBeUndefined()
    const confirmed = pendingReviewAnnotations({
      reviewStatus: 'confirmed',
      criticReview: { confidence: { band: 'medium' }, conflicts },
    })
    expect(confirmed.get('eta')).toBeUndefined()
  })
})
