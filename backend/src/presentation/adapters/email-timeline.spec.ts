import { describe, it, expect } from 'vitest'
import { emailFieldTimeline, dedupeAgainstAudit, type EmailEvidenceRow } from './email-timeline'

const row = (over: Partial<EmailEvidenceRow>): EmailEvidenceRow => ({
  messageId: 'm1',
  subject: 'subj',
  sender: 'a@b.c',
  receivedAt: new Date('2026-06-30T10:00:00Z'),
  fields: {},
  ...over,
})

describe('emailFieldTimeline — multi-booking emails only speak through THIS shipment\'s records', () => {
  it('ignores sibling bookings\' records (the BX808346/BX829735 flip-flop)', () => {
    // One email fans into 8 per-booking records; only the BX829735 one belongs to this shipment.
    const t = emailFieldTimeline(
      [
        row({ messageId: 'm1', receivedAt: new Date('2026-06-30T04:23:00Z'), fields: { booking_no: 'BX808346', cargo_ready_date: '2026-07-08' } }),
        row({ messageId: 'm1', receivedAt: new Date('2026-06-30T04:23:00Z'), fields: { booking_no: 'BX829735', so_no: 'S3Y0380824', cargo_ready_date: '2026-07-08' } }),
        row({ messageId: 'm2', receivedAt: new Date('2026-06-30T05:51:00Z'), fields: { booking_no: 'BX829735' } }),
      ],
      { bookingNo: 'BX829735' },
    )
    const bookings = t.filter((e) => e.field === 'bookingNo')
    expect(bookings).toHaveLength(1) // introduced once — never flips to the sibling BX808346
    expect(bookings[0]).toMatchObject({ newValue: 'BX829735' })
    // the shared delivery-date revision still lands, via the relevant record
    expect(t.find((e) => e.field === 'cargoReadyDate')).toMatchObject({ newValue: '2026-07-08' })
  })

  it('without shipment ids, behaves as before (all records speak)', () => {
    const t = emailFieldTimeline([row({ fields: { booking_no: 'BX1' } })])
    expect(t.find((e) => e.field === 'bookingNo')).toMatchObject({ newValue: 'BX1' })
  })
})

describe('emailFieldTimeline — replay per-email parsed evidence into field changes', () => {
  it('emits one entry per field an email INTRODUCES, and one per later CHANGE', () => {
    const t = emailFieldTimeline([
      row({ messageId: 'm1', receivedAt: new Date('2026-06-30T10:00:00Z'), fields: { booking_no: 'SE26060023', etd: '2026-07-05' } }),
      row({ messageId: 'm2', receivedAt: new Date('2026-07-01T09:00:00Z'), fields: { booking_no: 'SE26060023', etd: '2026-07-08', so_no: '260303045' } }),
    ])
    const byField = new Map(t.map((e) => [`${e.messageId}:${e.field}`, e]))
    expect(byField.get('m1:bookingNo')).toMatchObject({ oldValue: null, newValue: 'SE26060023' })
    expect(byField.get('m1:etd')).toMatchObject({ oldValue: null, newValue: '2026-07-05' })
    expect(byField.get('m2:etd')).toMatchObject({ oldValue: '2026-07-05', newValue: '2026-07-08' })
    expect(byField.get('m2:soNo')).toMatchObject({ oldValue: null, newValue: '260303045' })
    expect(byField.has('m2:bookingNo')).toBe(false) // unchanged → no entry
  })

  it('treats an email\'s multiple records as one statement (first non-null per field) and orders by receivedAt', () => {
    const t = emailFieldTimeline([
      row({ messageId: 'late', receivedAt: new Date('2026-07-02T10:00:00Z'), fields: { qty: 20 } }),
      row({ messageId: 'early', receivedAt: new Date('2026-07-01T10:00:00Z'), fields: { qty: null } }),
      row({ messageId: 'early', receivedAt: new Date('2026-07-01T10:00:00Z'), fields: { qty: 15 } }),
    ])
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ messageId: 'early', field: 'qty', oldValue: null, newValue: '15' })
    expect(t[1]).toMatchObject({ messageId: 'late', field: 'qty', oldValue: '15', newValue: '20' })
  })

  it('ignores untracked fields and null-only emails', () => {
    const t = emailFieldTimeline([row({ fields: { cancelled: true, customer_code: null } })])
    expect(t).toHaveLength(0)
  })
})

describe('dedupeAgainstAudit — synthesized entries never duplicate real audit rows', () => {
  it('drops an email entry when an audit row already records the same field+newValue (date-normalized)', () => {
    const entries = emailFieldTimeline([row({ fields: { etd: '2026-07-08' } })])
    const kept = dedupeAgainstAudit(entries, [
      { field: 'etd', newValue: '2026-07-08T00:00:00.000Z' }, // committer stores the coerced Date
    ])
    expect(kept).toHaveLength(0)
  })

  it('keeps entries whose value differs from every audit row', () => {
    const entries = emailFieldTimeline([row({ fields: { etd: '2026-07-08' } })])
    expect(dedupeAgainstAudit(entries, [{ field: 'etd', newValue: '2026-07-05T00:00:00.000Z' }])).toHaveLength(1)
    expect(dedupeAgainstAudit(entries, [{ field: 'qty', newValue: '2026-07-08' }])).toHaveLength(1)
  })
})
