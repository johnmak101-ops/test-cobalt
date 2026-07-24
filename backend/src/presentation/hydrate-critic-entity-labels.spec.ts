import { describe, expect, it } from 'vitest'
import type { CriticReview } from '../decisions/critic-review.types'
import {
  entityCodeNameMapsFromRefs,
  hydrateCriticEntityLabels,
  resolveEntityDisplayValue,
} from './hydrate-critic-entity-labels'

const maps = entityCodeNameMapsFromRefs(
  [
    { code: '058', name: 'APL LOGISTICS (CAMBODIA) PTE., LTD' },
    { code: '060', name: 'APL LOGISTICS LTD' },
  ],
  [{ code: 'ASC', name: 'Ascena Retail' }],
  [{ code: 'V01', name: 'Vendor One' }],
)

function sampleCr(over: Partial<CriticReview> = {}): CriticReview {
  return {
    confidence: { score: 0, band: 'low', label: 'low' },
    summary: 's',
    observations: [],
    priorState: { headline: 'h', fields: [] },
    proposedChanges: [],
    riskFlags: [],
    recommendedHumanAction: 'review',
    reasons: [],
    ...over,
  }
}

describe('resolveEntityDisplayValue', () => {
  it('maps forwarder Mesh codes to company names', () => {
    expect(resolveEntityDisplayValue('forwarder_name', '058', maps)).toBe(
      'APL LOGISTICS (CAMBODIA) PTE., LTD',
    )
    expect(resolveEntityDisplayValue('forwarder_name', '060', maps)).toBe('APL LOGISTICS LTD')
  })

  it('is case-insensitive on codes and leaves unknown values alone', () => {
    expect(resolveEntityDisplayValue('forwarder_name', '058', maps)).toContain('APL')
    expect(resolveEntityDisplayValue('forwarder_name', 'UNKNOWN_FWD', maps)).toBe('UNKNOWN_FWD')
    expect(resolveEntityDisplayValue('eta', '2026-08-01', maps)).toBe('2026-08-01')
  })
})

describe('hydrateCriticEntityLabels', () => {
  it('expands forwarder conflict candidates 058/060 to names (the review-table bug)', () => {
    const cr = sampleCr({
      conflicts: [
        {
          field: 'forwarder_name',
          label: 'forwarder name',
          candidates: [
            { value: '058', source: 'Booking Request' },
            { value: '060', source: 'Booking Request' },
          ],
          rationale: 'Emails disagree',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    const vals = out.conflicts![0]!.candidates.map((c) => c.value)
    expect(vals).toEqual([
      'APL LOGISTICS (CAMBODIA) PTE., LTD',
      'APL LOGISTICS LTD',
    ])
  })

  it('hydrates proposedChanges entity fields', () => {
    const cr = sampleCr({
      proposedChanges: [
        {
          field: 'forwarder_name',
          priorValue: null,
          proposedValue: '060',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    const row = out.proposedChanges[0] as { proposedValue: string }
    expect(row.proposedValue).toBe('APL LOGISTICS LTD')
  })

  it('attaches master {code, name} when a vendor candidate stores the Mesh code', () => {
    const cr = sampleCr({
      conflicts: [
        {
          field: 'vendor_code',
          label: 'Vendor',
          candidates: [{ value: 'V01', source: 'Booking Request' }],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    const cand = out.conflicts![0]!.candidates[0]!
    expect(cand.value).toBe('Vendor One')
    expect(cand.master).toEqual({ code: 'V01', name: 'Vendor One' })
  })

  it('attaches master via exact-name reverse lookup without changing the value', () => {
    const cr = sampleCr({
      conflicts: [
        {
          field: 'vendor_code',
          label: 'Vendor',
          candidates: [{ value: 'VENDOR ONE', source: 'SO' }],
          rationale: 'r',
        },
        {
          field: 'customer_code',
          label: 'Customer',
          candidates: [{ value: 'ascena retail', source: 'SO' }],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    const vendor = out.conflicts![0]!.candidates[0]!
    expect(vendor.value).toBe('VENDOR ONE')
    expect(vendor.master).toEqual({ code: 'V01', name: 'Vendor One' })
    const customer = out.conflicts![1]!.candidates[0]!
    expect(customer.value).toBe('ascena retail')
    expect(customer.master).toEqual({ code: 'ASC', name: 'Ascena Retail' })
  })

  it('flags unresolved letter-bearing party candidates as master: null', () => {
    const cr = sampleCr({
      conflicts: [
        {
          field: 'vendor_code',
          label: 'Vendor',
          candidates: [{ value: 'GOLDEN SUN KNITTING FTY LTD', source: 'SO' }],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    expect(out.conflicts![0]!.candidates[0]!.master).toBeNull()
  })

  it('never flags numeric party values and never touches non-party fields', () => {
    const cr = sampleCr({
      conflicts: [
        {
          field: 'vendor_code',
          label: 'Vendor',
          candidates: [{ value: '1012485', source: 'SO' }],
          rationale: 'r',
        },
        {
          field: 'eta',
          label: 'ETA',
          candidates: [{ value: '2026-08-01', source: 'SO' }],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    expect(out.conflicts![0]!.candidates[0]!.master).toBeUndefined()
    expect(out.conflicts![1]!.candidates[0]!.master).toBeUndefined()
  })

  it('skips reverse-name lookup when two masters share the normalized name', () => {
    const dupMaps = entityCodeNameMapsFromRefs(
      [],
      undefined,
      [
        { code: 'A1', name: 'ACME LTD' },
        { code: 'A2', name: 'Acme Ltd.' },
      ],
    )
    const cr = sampleCr({
      conflicts: [
        {
          field: 'vendor_code',
          label: 'Vendor',
          candidates: [{ value: 'ACME LTD', source: 'SO' }],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, dupMaps)!
    // Ambiguous is NOT missing — no chip, but no "not in Mesh" claim either.
    expect(out.conflicts![0]!.candidates[0]!.master).toBeUndefined()
  })

  it('returns null for null input and leaves non-entity conflicts untouched', () => {
    expect(hydrateCriticEntityLabels(null, maps)).toBeNull()
    const cr = sampleCr({
      conflicts: [
        {
          field: 'eta',
          label: 'ETA',
          candidates: [
            { value: '2026-08-01', source: 'System' },
            { value: '2026-08-05', source: 'Email' },
          ],
          rationale: 'r',
        },
      ],
    })
    const out = hydrateCriticEntityLabels(cr, maps)!
    expect(out.conflicts![0]!.candidates.map((c) => c.value)).toEqual([
      '2026-08-01',
      '2026-08-05',
    ])
  })
})
