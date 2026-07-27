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
  /** House B/L / HAWB / FCR when present on the provisional leg. */
  hblAwbFcrNo?: string | null
  customer: string | null
  forwarder: string | null
  route: string | null
  state: string | null
  status: string
  reviewReasons: string[]
  /** Queue-safe AI critic projection (never raw confidence score). */
  criticReviewCompact: CriticReviewCompact | null
  /** #350: beginning email — anchors the derived Shipment ID (UI falls back to createdAt). */
  firstEmailAt?: string | null
  createdAt: string
  /** ISO timestamp for optimistic concurrency on confirm/correct. */
  updatedAt: string
  poCount: number
  dismissedAt: string | null
  /** See ShipmentDetail.committerAction (migration 0027). */
  committerAction?: string | null
  committerCandidatesConsidered?: number | null
  /** Parked off the active desk pending an outside answer (migration 0025). */
  waitingAt?: string | null
  /** What the operator said they were waiting on — shown inline on the Waiting tab. */
  waitingReason?: string | null
}

interface ReviewQueueResponse {
  shipments: ReviewShipment[]
}

export interface ReviewCounts {
  provisional: number
  dismissed: number
  waiting: number
}

/** UI tab keys — mapped to backend `view=` query params. */
export type ReviewQueueView = 'active' | 'waiting' | 'rejected' | 'approved'

/** Backend GET /shipments/review-queue?view= values. */
export type ReviewQueueApiView = 'pending' | 'dismissed' | 'approved' | 'waiting'

const VIEW_TO_API: Record<ReviewQueueView, ReviewQueueApiView> = {
  active: 'pending',
  waiting: 'waiting',
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

/**
 * Park ONE leg as waiting: it leaves the Active desk for the Waiting tab, unanswered. The desk's third
 * outcome — before this, a question whose answer lived in someone else's inbox either sat in Active
 * forever or got rejected as noise. Reversible via useRestoreShipment.
 */
export function useWaitShipment() {
  const invalidate = useInvalidateReview()
  return useMutation({
    mutationFn: ({ shipmentId, reason }: { shipmentId: string; reason?: string }) =>
      api.post(`/review/${shipmentId}/wait`, { ...(reason?.trim() ? { reason: reason.trim() } : {}) }),
    onSuccess: invalidate,
  })
}

/** Undo a dismiss OR un-park a waiting leg — either way the shipment returns to the Active queue. */
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
 * Fold a provisional into an existing shipment (emails + POs copied; source leaves the Active queue).
 * Does NOT create an "Approved" row — the source is dismissed/linked; open the target shipment to see data.
 */
export function useLinkShipment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      shipmentId,
      targetShipmentId,
      fields,
      reason,
    }: {
      shipmentId: string
      targetShipmentId: string
      /** CamelCase leg columns applied to the **target** before merge. */
      fields?: Record<string, unknown>
      reason?: string
    }) =>
      api.post<{ ok: true; targetShipmentId: string }>(`/review/${shipmentId}/link`, {
        targetShipmentId,
        ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      }),
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
