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

/** Approve (confirm) a provisional shipment — promotes it out of the review queue. */
export function useConfirmShipment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (shipmentId: string) => api.post(`/shipments/${shipmentId}/confirm`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['review-counts'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
