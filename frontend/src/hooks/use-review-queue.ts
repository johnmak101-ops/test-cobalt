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
  dismissedAt: string | null
}

interface ReviewQueueResponse {
  shipments: ReviewShipment[]
}

export interface ReviewCounts {
  provisional: number
  dismissed: number
}

export type ReviewQueueView = 'pending' | 'dismissed'

export function useReviewQueue(view: ReviewQueueView = 'pending') {
  return useQuery<ReviewQueueResponse>({
    queryKey: ['review-queue', view],
    queryFn: () => api.get(`/shipments/review-queue?view=${view}`),
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

/**
 * Bulk "not a trackable shipment" (#133): stamps dismissed_at so the rows leave the queue WITHOUT
 * confirming their data (no learning-feed confirm signals). Reversible via useRestoreShipment.
 */
export function useDismissShipments() {
  const invalidate = useInvalidateReview()
  return useMutation({
    mutationFn: ({ shipmentIds, note }: { shipmentIds: string[]; note?: string }) =>
      api.post('/review/dismiss', { shipmentIds, ...(note?.trim() ? { note: note.trim() } : {}) }),
    onSuccess: invalidate,
  })
}

/** Undo a dismiss — the shipment returns to the pending review queue. */
export function useRestoreShipment() {
  const invalidate = useInvalidateReview()
  return useMutation({
    mutationFn: ({ shipmentId }: { shipmentId: string }) => api.post(`/review/${shipmentId}/restore`, {}),
    onSuccess: invalidate,
  })
}
