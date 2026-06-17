import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** One queued email extraction + its human review-state (tracking.review_email). */
export interface ReviewEmail {
  id: string
  messageId: string | null
  graphMessageId: string | null
  subject: string | null
  sender: string | null
  receivedAt: string | null
  bodyText: string | null
  emailType: string | null
  extractedData: Record<string, unknown> | null
  originalExtractedData: Record<string, unknown> | null
  suggestedData: Record<string, unknown> | null
  reviewerNotes: string | null
  extractionConfidence: number | null
  shipmentId: string | null
  reviewStatus: string
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
  // light shipment context for the card chip
  jobNo: string | null
  shipmentState: string | null
}

interface ReviewQueueResponse {
  emails: ReviewEmail[]
}

export interface ReviewCounts {
  NEEDS_REVIEW: number
  AUTO_ACCEPTED: number
  REVIEWED_OK: number
  REVIEWED_CORRECTED: number
  REJECTED: number
  total: number
  pending: number
}

export function useReviewQueue(status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return useQuery<ReviewQueueResponse>({
    queryKey: ['review-queue', status],
    queryFn: () => api.get(`/emails/review-queue${query}`),
  })
}

export function useReviewCounts() {
  return useQuery<ReviewCounts>({
    queryKey: ['review-counts'],
    queryFn: () => api.get('/emails/review-queue/counts'),
    refetchInterval: 30000, // keep the sidebar/tab badges fresh
  })
}

export function useReviewEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      emailId,
      action,
      notes,
      corrections,
    }: {
      emailId: string
      action: 'approve' | 'correct' | 'reject'
      notes?: string
      corrections?: { extractedData?: Record<string, unknown> }
    }) => api.patch(`/emails/${emailId}/review`, { action, notes, corrections }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['review-counts'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
