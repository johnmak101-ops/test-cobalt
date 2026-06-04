import { useQuery } from '@tanstack/react-query'
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
