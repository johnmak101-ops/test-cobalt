/**
 * Assemble the UI's inbox `ShippingEmail` from a `queue.queue_message` (+ optional
 * `tracking.review_email` overlay). Pure. `isRead` comes from the `tracking.email_read` overlay
 * (readAt != null); it is false when no read-state row exists for the message.
 */
import { isoOrNull } from '../adapters/derive'

type Dateish = Date | string | null | undefined

export interface EmailMessageRow {
  id: string
  graphMessageId: string | null
  subject: string
  sender: string
  receivedAt: Dateish
  status: string | null
  createdAt: Dateish
}

export interface EmailReviewOverlay {
  emailType: string | null
  extractedData: unknown
  extractionConfidence: number | null
  reviewStatus: string | null
  reviewedBy: string | null
  reviewedAt: Dateish
  reviewNotes: string | null
  shipmentId: string | null
}

export interface EmailMapperInput {
  message: EmailMessageRow
  review?: EmailReviewOverlay | null
  readAt?: Dateish // app-owned read-state (tracking.email_read); null/undefined = unread
}

export interface UiShippingEmail {
  id: string
  messageId: string | null
  subject: string
  sender: string
  receivedAt: string | null
  emailType: string | null
  extractedData: string | null
  extractionConfidence: number | null
  shipmentId: string | null
  isMatched: boolean
  isRead: boolean
  processingStatus: string
  reviewStatus: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string | null
}

/** queue_message.status (rich) -> UI processingStatus (PENDING|PROCESSING|COMPLETED|FAILED). */
const QUEUE_STATUS_TO_UI: Record<string, string> = {
  PENDING: 'PENDING',
  NORMALIZING: 'PROCESSING',
  QUEUED: 'PROCESSING',
  PROCESSING: 'PROCESSING',
  DONE: 'COMPLETED',
  FAILED: 'FAILED',
  DEAD_LETTER: 'FAILED',
}

/** review_email.emailType (Title Case) -> UI shipping_emails.emailType (SCREAMING_SNAKE). */
const EMAIL_TYPE_TO_UI: Record<string, string> = {
  'Booking Request': 'BOOKING_REQUEST',
  SO: 'SHIPPING_ORDER',
  'Draft B/L': 'DRAFT_BL',
  'Final B/L': 'FINAL_BL',
  'Telex Release': 'FINAL_BL',
  'Invoice/Billing': 'OTHER',
  Customs: 'OTHER',
  Other: 'OTHER',
}

function emailTypeToUi(t: string | null | undefined): string | null {
  if (t == null) return null
  return EMAIL_TYPE_TO_UI[t] ?? 'OTHER'
}

export function toUiEmail(input: EmailMapperInput): UiShippingEmail {
  const { message, review } = input
  return {
    id: message.id,
    messageId: message.graphMessageId ?? null,
    subject: message.subject,
    sender: message.sender,
    receivedAt: isoOrNull(message.receivedAt),
    emailType: emailTypeToUi(review?.emailType),
    extractedData: review?.extractedData != null ? JSON.stringify(review.extractedData) : null,
    extractionConfidence: review?.extractionConfidence ?? null,
    shipmentId: review?.shipmentId ?? null,
    isMatched: review?.shipmentId != null,
    isRead: input.readAt != null,
    processingStatus: (message.status && QUEUE_STATUS_TO_UI[message.status]) || 'PENDING',
    reviewStatus: review?.reviewStatus ?? null,
    reviewedBy: review?.reviewedBy ?? null,
    reviewedAt: isoOrNull(review?.reviewedAt),
    reviewNotes: review?.reviewNotes ?? null,
    createdAt: isoOrNull(message.createdAt),
  }
}
