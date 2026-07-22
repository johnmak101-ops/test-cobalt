import { describe, expect, it } from 'vitest'
import { aggregateMisses } from './mesh-misses.service'

const leg = (id: string, seen: string, misses: unknown[]) => ({
  id,
  createdAt: seen,
  criticReview: JSON.stringify({ masterMisses: misses }),
})

describe('aggregateMisses', () => {
  it('groups by type + normalized name, counts, tracks first/last seen', () => {
    const rows = aggregateMisses(
      [
        leg('s1', '2026-07-01T00:00:00Z', [{ type: 'vendor', rawName: 'ACME  Ltd', field: 'vendor' }]),
        leg('s2', '2026-07-10T00:00:00Z', [{ type: 'vendor', rawName: 'acme ltd', field: 'vendor' }]),
      ],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'vendor',
      normalizedName: 'acme ltd',
      count: 2,
      status: 'open',
    })
    expect(rows[0]!.shipmentIds).toEqual(['s1', 's2'])
  })

  it('acked hides inside 7 days, recurs after', () => {
    const acks = [{ type: 'vendor', normalized_name: 'acme ltd', acked_at: '2026-07-02T00:00:00Z' }]
    const recentOnly = aggregateMisses(
      [leg('s3', '2026-07-03T00:00:00Z', [{ type: 'vendor', rawName: 'ACME Ltd', field: 'vendor' }])],
      acks,
    )
    expect(recentOnly[0]!.status).toBe('acked')
    const recurred = aggregateMisses(
      [leg('s4', '2026-07-15T00:00:00Z', [{ type: 'vendor', rawName: 'ACME Ltd', field: 'vendor' }])],
      acks,
    )
    expect(recurred[0]!.status).toBe('recurred')
  })

  // A PO/booking number leaking into a party field is not a Mesh-add candidate — the worklist tells
  // ops to add the name in Mesh, which is unactionable for a bare number.
  it('drops numeric-only party names, keeping real ones from the same leg', () => {
    const rows = aggregateMisses(
      [
        leg('s1', '2026-07-01T00:00:00Z', [
          { type: 'vendor', rawName: '4483262', field: 'vendor' },
          { type: 'vendor', rawName: '123-456', field: 'vendor' },
          { type: 'vendor', rawName: '2026-02-17', field: 'vendor' },
          { type: 'vendor', rawName: 'Rose Knit', field: 'vendor' },
        ]),
      ],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.rawName).toBe('Rose Knit')
  })

  it('keeps CJK and letter+digit brand names', () => {
    const rows = aggregateMisses(
      [
        leg('s1', '2026-07-01T00:00:00Z', [
          { type: 'vendor', rawName: '南海制衣', field: 'vendor' },
          { type: 'forwarder', rawName: '3M', field: 'forwarder' },
        ]),
      ],
      [],
    )
    expect(rows.map((r) => r.rawName).sort()).toEqual(['3M', '南海制衣'])
  })

  it('ignores legs without masterMisses and unparsable JSON', () => {
    expect(
      aggregateMisses(
        [{ id: 'x', createdAt: '2026-07-01T00:00:00Z', criticReview: '{broken' as never }],
        [],
      ),
    ).toEqual([])
  })
})
