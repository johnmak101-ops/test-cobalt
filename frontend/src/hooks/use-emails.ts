import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface ShippingEmail {
  id: string
  messageId: string | null
  subject: string
  sender: string
  receivedAt: string
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
  createdAt: string
}

interface EmailsResponse {
  emails: ShippingEmail[]
}

export function useEmails() {
  return useQuery<EmailsResponse>({
    queryKey: ['emails'],
    queryFn: () => api.get('/emails'),
  })
}

export interface EmailAttachment {
  id: string
  emailId: string
  filename: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

interface AttachmentsResponse {
  attachments: EmailAttachment[]
}

export function useEmailAttachments(emailId: string | undefined) {
  return useQuery<AttachmentsResponse>({
    queryKey: ['email-attachments', emailId],
    queryFn: () => api.get(`/emails/${emailId}/attachments`),
    enabled: !!emailId,
  })
}

export interface EmailBody {
  id: string
  subject: string
  sender: string
  receivedAt: string | null
  bodyText: string | null
  bodyHtml: string | null
  toRecipients: string | null
  ccRecipients: string | null
}

export function useEmailBody(emailId: string | undefined) {
  return useQuery<EmailBody>({
    queryKey: ['email-body', emailId],
    queryFn: () => api.get(`/emails/${emailId}/body`),
    enabled: !!emailId,
  })
}

export interface ThreadMessage {
  id: string
  subject: string
  sender: string
  receivedAt: string | null
  attachmentCount: number
}

/** All ingested messages in the same conversation (incl. this one), oldest first, with attachment counts. */
export function useEmailThread(emailId: string | undefined) {
  return useQuery<{ messages: ThreadMessage[] }>({
    queryKey: ['email-thread', emailId],
    queryFn: () => api.get(`/emails/${emailId}/thread`),
    enabled: !!emailId,
  })
}

export function useUnreadCount() {
  return useQuery<{ unread: number }>({
    queryKey: ['emails', 'unread-count'],
    queryFn: () => api.get('/emails/unread-count'),
  })
}

export function useMarkEmailRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (emailId: string) => api.patch(`/emails/${emailId}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emails'] })
    },
  })
}
