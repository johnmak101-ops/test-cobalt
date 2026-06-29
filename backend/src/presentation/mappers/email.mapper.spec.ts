import { describe, it, expect } from 'vitest'
import { toUiEmail, type EmailMessageRow, type EmailReviewOverlay } from './email.mapper'

const message = (over: Partial<EmailMessageRow> = {}): EmailMessageRow => ({
  id: 'msg-1',
  graphMessageId: 'graph-abc',
  subject: 'Final B/L — HBL TQHK1180994',
  sender: 'docs@torque-shipair.example',
  receivedAt: new Date('2026-02-08T09:12:00.000Z'),
  status: 'DONE',
  createdAt: new Date('2026-02-08T09:13:00.000Z'),
  ...over,
})

const review = (over: Partial<EmailReviewOverlay> = {}): EmailReviewOverlay => ({
  emailType: 'Final B/L',
  extractedData: { booking_no: 'BK-1', hbl_awb_fcr_no: 'TQHK1180994' },
  extractionConfidence: 0.65,
  reviewStatus: 'NEEDS_REVIEW',
  reviewedBy: null,
  reviewedAt: null,
  reviewNotes: null,
  shipmentId: 'leg-1',
  ...over,
})

describe('toUiEmail — queue message (+review overlay) -> UI ShippingEmail', () => {
  it('assembles the inbox row, stringifies extractedData, derives isMatched', () => {
    const e = toUiEmail({ message: message(), review: review() })
    expect(e.id).toBe('msg-1')
    expect(e.messageId).toBe('graph-abc')
    expect(e.subject).toContain('Final B/L')
    expect(e.sender).toBe('docs@torque-shipair.example')
    expect(e.receivedAt).toBe('2026-02-08T09:12:00.000Z')
    expect(e.emailType).toBe('FINAL_BL')
    expect(e.extractedData).toBe('{"booking_no":"BK-1","hbl_awb_fcr_no":"TQHK1180994"}')
    expect(e.extractionConfidence).toBe(0.65)
    expect(e.shipmentId).toBe('leg-1')
    expect(e.isMatched).toBe(true)
    expect(e.reviewStatus).toBe('NEEDS_REVIEW')
    expect(e.processingStatus).toBe('COMPLETED') // queue DONE -> UI COMPLETED
    expect(e.isRead).toBe(false) // no read-state row → unread
  })

  it('marks isRead true when an email_read row (readAt) is present', () => {
    expect(toUiEmail({ message: message(), readAt: new Date('2026-06-29T00:00:00.000Z') }).isRead).toBe(true)
    expect(toUiEmail({ message: message(), readAt: null }).isRead).toBe(false)
  })

  it('handles a message with no review overlay', () => {
    const e = toUiEmail({ message: message({ status: 'QUEUED' }) })
    expect(e.emailType).toBeNull()
    expect(e.extractedData).toBeNull()
    expect(e.extractionConfidence).toBeNull()
    expect(e.shipmentId).toBeNull()
    expect(e.isMatched).toBe(false)
    expect(e.reviewStatus).toBeNull()
    expect(e.processingStatus).toBe('PROCESSING') // QUEUED -> PROCESSING
  })

  it('maps email-type vocabulary and falls back to OTHER for unknowns', () => {
    expect(toUiEmail({ message: message(), review: review({ emailType: 'Booking Request' }) }).emailType).toBe('BOOKING_REQUEST')
    expect(toUiEmail({ message: message(), review: review({ emailType: 'SO' }) }).emailType).toBe('SHIPPING_ORDER')
    expect(toUiEmail({ message: message(), review: review({ emailType: 'Customs' }) }).emailType).toBe('OTHER')
  })

  it('maps failed/dead-letter queue states to FAILED', () => {
    expect(toUiEmail({ message: message({ status: 'FAILED' }) }).processingStatus).toBe('FAILED')
    expect(toUiEmail({ message: message({ status: 'DEAD_LETTER' }) }).processingStatus).toBe('FAILED')
  })
})
