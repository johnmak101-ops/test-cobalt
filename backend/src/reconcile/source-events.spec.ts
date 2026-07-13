import { describe, it, expect } from 'vitest'
import { collectSourceEvents } from './source-events'

describe('collectSourceEvents — Related Emails never lose a source graph id', () => {
  it('unions events + evidence + evidenceRefs + identifiers + bare evidenceIds', () => {
    const rows = collectSourceEvents({
      events: [{ emailType: 'SO', receivedAt: '2026-06-01T00:00:00Z', graphId: 'g-so' }],
      evidenceRefs: [{ graphMessageId: 'g-ref', emailType: 'Booking Request', receivedAt: '2026-06-02T00:00:00Z' }],
      evidence: [{ graphMessageId: 'g-ev', emailType: 'Final B/L', receivedAt: '2026-06-03T00:00:00Z' }],
      identifiers: [{ sourceEmailId: 'g-id', docType: 'Other', observedAt: '2026-06-04T00:00:00Z' }],
      evidenceIds: ['g-bare'],
    })
    const ids = rows.map((r) => r.graphId).sort()
    expect(ids).toEqual(['g-bare', 'g-ev', 'g-id', 'g-ref', 'g-so'])
  })

  it('recovers a leg when events are empty but identifiers carry sourceEmailId (the UI bug)', () => {
    const rows = collectSourceEvents({
      events: [],
      identifiers: [
        {
          sourceEmailId: '<CO6PR05MB7793@outlook.com>',
          docType: 'Other',
          observedAt: '2026-06-29T08:33:58Z',
        },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.graphId).toBe('<CO6PR05MB7793@outlook.com>')
    expect(rows[0]!.emailType).toBe('Other')
  })

  it('prefers a non-Other type and the newer receivedAt when the same id appears twice', () => {
    const rows = collectSourceEvents({
      events: [{ emailType: 'Other', receivedAt: '2026-06-01T00:00:00Z', graphId: 'g1' }],
      evidence: [{ graphMessageId: 'g1', emailType: 'Final B/L', receivedAt: '2026-06-10T00:00:00Z' }],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.emailType).toBe('Final B/L')
    expect(rows[0]!.receivedAt).toBe('2026-06-10T00:00:00Z')
  })

  it('drops blank graph ids', () => {
    expect(
      collectSourceEvents({
        events: [{ emailType: 'SO', receivedAt: '2026-06-01T00:00:00Z', graphId: null }],
        identifiers: [{ sourceEmailId: '  ', docType: 'SO' }],
        evidenceIds: [null, undefined, ''],
      }),
    ).toEqual([])
  })
})
