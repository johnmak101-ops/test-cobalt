import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { CriticReviewCompact } from '../lib/critic-review'
import { mapCriticFieldsToColumns } from '../lib/review-fields'
import type { IdentifyResult } from '../components/review/ReviewCard'

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
  /** Queue-safe AI critic projection (never raw confidence score). */
  criticReviewCompact: CriticReviewCompact | null
  createdAt: string
  /** ISO timestamp for optimistic concurrency on confirm/correct. */
  updatedAt: string
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

/** UI tab keys — mapped to backend `view=` query params. */
export type ReviewQueueView = 'active' | 'rejected' | 'approved'

/** Backend GET /shipments/review-queue?view= values. */
export type ReviewQueueApiView = 'pending' | 'dismissed' | 'approved'

const VIEW_TO_API: Record<ReviewQueueView, ReviewQueueApiView> = {
  active: 'pending',
  rejected: 'dismissed',
  approved: 'approved',
}

export function reviewQueueApiView(view: ReviewQueueView): ReviewQueueApiView {
  return VIEW_TO_API[view]
}

export function useReviewQueue(view: ReviewQueueView = 'active') {
  const apiView = reviewQueueApiView(view)
  return useQuery<ReviewQueueResponse>({
    queryKey: ['review-queue', view],
    queryFn: () => api.get(`/shipments/review-queue?view=${apiView}`),
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

function isStaleConflict(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /\b409\b/.test(msg) || /modified|reload/i.test(msg)
}

/**
 * Approve (confirm) a provisional shipment as-is — promotes it out of the review queue.
 * Goes through /api/review (audited + reviewedBy); an optional reviewer note lands in the
 * audit trail for agent-soul feedback.
 */
export function useConfirmShipment() {
  const invalidate = useInvalidateReview()

  return useMutation({
    mutationFn: ({
      shipmentId,
      note,
      expectedUpdatedAt,
    }: {
      shipmentId: string
      note?: string
      /** ISO from load; backend 409s if leg was modified since. */
      expectedUpdatedAt?: string
    }) =>
      api.post(`/review/${shipmentId}/confirm`, {
        ...(note?.trim() ? { note: note.trim() } : {}),
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      }),
    onSuccess: invalidate,
  })
}

/**
 * Correct fields on a provisional shipment and approve it. Each edited field is locked
 * (human-wins — the agent can never overwrite it) and audited with the reviewer's reason.
 * Critic snake_case field keys are mapped to camelCase leg columns before POST.
 */
export function useCorrectShipment() {
  const invalidate = useInvalidateReview()

  return useMutation({
    mutationFn: ({
      shipmentId,
      fields,
      reason,
      expectedUpdatedAt,
    }: {
      shipmentId: string
      fields: Record<string, unknown>
      reason?: string
      /** ISO from load; backend 409s if leg was modified since. */
      expectedUpdatedAt?: string
    }) =>
      api.post(`/review/${shipmentId}/correct`, {
        fields: mapCriticFieldsToColumns(fields),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      }),
    onSuccess: invalidate,
  })
}

export { isStaleConflict }

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

/**
 * Type a strong ID on a zero-identity provisional leg.
 * Returns candidate / set / ambiguous — never silently merges.
 */
export function useIdentifyShipment() {
  const invalidate = useInvalidateReview()

  return useMutation({
    mutationFn: ({
      shipmentId,
      field,
      value,
    }: {
      shipmentId: string
      field: string
      value: string
    }) => api.post<IdentifyResult>(`/review/${shipmentId}/identify`, { field, value }),
    onSuccess: invalidate,
  })
}

/**
 * Fold a zero-identity provisional into an existing shipment that carries the typed key.
 * Invalidates queue + counts + both shipment detail caches.
 */
export function useLinkShipment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      shipmentId,
      targetShipmentId,
    }: {
      shipmentId: string
      targetShipmentId: string
    }) => api.post(`/review/${shipmentId}/link`, { targetShipmentId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['review-counts'] })
      queryClient.invalidateQueries({ queryKey: ['shipments'] })
      queryClient.invalidateQueries({ queryKey: ['shipment', vars.shipmentId] })
      queryClient.invalidateQueries({ queryKey: ['shipment', vars.targetShipmentId] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
