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
