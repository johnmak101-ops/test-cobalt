import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export interface ReviewEmail {
  id: string
  messageId: string | null
  subject: string
  sender: string
  receivedAt: string
  bodyText: string | null
  emailType: string | null
  extractedData: Record<string, unknown> | string | null
  originalExtractedData: Record<string, unknown> | string | null
  extractionConfidence: number | null
  shipmentId: string | null
  isMatched: boolean
  processingStatus: string
  reviewStatus: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
  suggestedData: Record<string, unknown> | string | null
  reviewerNotes: string | null
  shipment?: {
    id: string
    poNumbers: string
    status: string
    route: string | null
    bookingNo: string | null
    vesselName: string | null
    voyageNumber: string | null
    hblNumber: string | null
    mblNumber: string | null
    containerNo: string | null
    quantityShipped: number | null
    quantityUnit: string | null
    etd: string | null
    eta: string | null
    crd: string | null
    cfsCutoff: string | null
    consigneeName: string | null
    consigneeAddress: string | null
    soNumber: string | null
    warehouseAddress: string | null
  } | null
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
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  const query = params.toString()

  return useQuery<ReviewQueueResponse>({
    queryKey: ['review-queue', status],
    queryFn: () => api.get(`/emails/review-queue${query ? `?${query}` : ''}`),
  })
}

export function useReviewCounts() {
  return useQuery<ReviewCounts>({
    queryKey: ['review-counts'],
    queryFn: () => api.get('/emails/review-queue/counts'),
    refetchInterval: 30000, // Refresh every 30s for badge count
  })
}

export function useReviewEmail() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      emailId,
      action,
      reviewedBy,
      notes,
      corrections,
    }: {
      emailId: string
      action: 'approve' | 'correct' | 'reject'
      reviewedBy: string
      notes?: string
      corrections?: {
        extractedData?: Record<string, unknown>
        emailType?: string
        shipmentId?: string | null
        shipmentUpdates?: Record<string, unknown>
      }
    }) =>
      api.patch(`/emails/${emailId}/review`, {
        action,
        reviewedBy,
        notes,
        corrections,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['review-counts'] })
      queryClient.invalidateQueries({ queryKey: ['emails'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      queryClient.invalidateQueries({ queryKey: ['purchase-order'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
    },
  })
}
