import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** A provisional shipment awaiting human confirmation. Shape fixed by the backend contract for
 *  GET /api/shipments/review-queue. `reviewReasons` explains WHY the matcher held it back. */
export interface ReviewShipment {
  id: string
  bookingNo: string | null
  soNo: string | null
  customer: string | null
  forwarder: string | null
  route: string | null
  state: string | null
  status: string
  reviewReasons: string[]
  createdAt: string
  poCount: number
}

interface ReviewQueueResponse {
  shipments: ReviewShipment[]
}

export interface ReviewCounts {
  provisional: number
}

export function useReviewQueue() {
  return useQuery<ReviewQueueResponse>({
    queryKey: ['review-queue'],
    queryFn: () => api.get('/shipments/review-queue'),
  })
}

export function useReviewCounts() {
  return useQuery<ReviewCounts>({
    queryKey: ['review-counts'],
    queryFn: () => api.get('/shipments/review-queue/counts'),
    refetchInterval: 30000, // Refresh every 30s for the sidebar badge count
  })
}

function useInvalidateReview() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    queryClient.invalidateQueries({ queryKey: ['review-counts'] })
    queryClient.invalidateQueries({ queryKey: ['shipments'] })
    queryClient.invalidateQueries({ queryKey: ['shipment'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }
}

/**
 * Approve (confirm) a provisional shipment as-is — promotes it out of the review queue.
 * Goes through /api/review (audited + reviewedBy); an optional reviewer note lands in the
 * audit trail for agent-soul feedback.
 */
export function useConfirmShipment() {
  const invalidate = useInvalidateReview()

  return useMutation({
    mutationFn: ({ shipmentId, note }: { shipmentId: string; note?: string }) =>
      api.post(`/review/${shipmentId}/confirm`, note?.trim() ? { note: note.trim() } : {}),
    onSuccess: invalidate,
  })
}

/**
 * Correct fields on a provisional shipment and approve it. Each edited field is locked
 * (human-wins — the agent can never overwrite it) and audited with the reviewer's reason.
 */
export function useCorrectShipment() {
  const invalidate = useInvalidateReview()

  return useMutation({
    mutationFn: ({
      shipmentId,
      fields,
      reason,
    }: {
      shipmentId: string
      fields: Record<string, unknown>
      reason?: string
    }) => api.post(`/review/${shipmentId}/correct`, { fields, ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
    onSuccess: invalidate,
  })
}
