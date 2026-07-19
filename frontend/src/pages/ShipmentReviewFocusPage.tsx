import { useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { useShipment } from '../hooks/use-shipments'
import {
  useConfirmShipment,
  useCorrectShipment,
  useDismissShipments,
  useIdentifyShipment,
  useLinkShipment,
  isStaleConflict,
} from '../hooks/use-review-queue'
import { ReviewCard, type ReviewCardSavePayload } from '../components/review/ReviewCard'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { mapCriticFieldsToColumns } from '../lib/review-fields'
import { toast } from '../components/ui/Toast'

/**
 * Focused, deep-linkable review view for ONE shipment (/review-queue/:id).
 *
 * The shipment detail page's "see conflict table" and "Review & approve" CTAs land here instead of
 * dumping the operator on the queue's landing page (where the row was often paginated out or below
 * the fold). It reuses the queue's presentational ReviewCard — the conflict table + Approve/Dismiss/
 * Save — so there is still ONE conflict UI. The approve/correct/dismiss wiring mirrors the queue's
 * ExpandedReviewPanel + saveAndApproveFor in ReviewQueuePage.tsx; keep the two in step.
 */
export default function ShipmentReviewFocusPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  // Return to wherever the operator came from (the shipment detail, the queue, an alert…), not always
  // the queue. `location.key === 'default'` means this was opened directly / deep-linked with no
  // in-app history to pop, so fall back to the queue.
  const canGoBack = location.key !== 'default'
  const goBack = () => (canGoBack ? navigate(-1) : navigate('/review-queue'))
  const { data: shipment, isLoading, isError } = useShipment(id!)

  const confirmMutation = useConfirmShipment()
  const correctMutation = useCorrectShipment()
  const dismissMutation = useDismissShipments()
  const identifyMutation = useIdentifyShipment()
  const linkMutation = useLinkShipment()

  const [staleBanner, setStaleBanner] = useState<string | null>(null)

  const backButton = (
    <button
      type="button"
      onClick={goBack}
      className="mb-3 inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary"
    >
      <ArrowLeft size={14} />
      {canGoBack ? 'Back' : 'Back to Review Queue'}
    </button>
  )

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-text-muted">Loading review…</span>
      </div>
    )
  }

  if (isError || !shipment) {
    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex h-48 items-center justify-center">
          <span className="text-sm text-status-critical">
            This shipment could not be loaded. It may have been confirmed or removed.
          </span>
        </div>
      </div>
    )
  }

  // A confirmed/dismissed leg opened directly by URL is shown read-only (no approve/edit actions).
  const readOnly = shipment.reviewStatus !== 'provisional'
  const backToShipment = `/shipments/${shipment.id}`
  const bookingLabel = shipment.bookingNo ?? shipment.soNumber ?? shipment.id.slice(0, 8)

  const handleStale = async (err: unknown) => {
    if (!isStaleConflict(err)) throw err
    setStaleBanner('This shipment was modified elsewhere — reloading its latest values.')
    await queryClient.invalidateQueries({ queryKey: ['shipment', shipment.id] })
  }

  const onApprove = async () => {
    setStaleBanner(null)
    try {
      await confirmMutation.mutateAsync({
        shipmentId: shipment.id,
        expectedUpdatedAt: shipment.updatedAt,
      })
      toast('Shipment approved')
      navigate(backToShipment)
    } catch (err) {
      await handleStale(err)
    }
  }

  const onDismiss = async () => {
    setStaleBanner(null)
    try {
      await dismissMutation.mutateAsync({ shipmentIds: [shipment.id] })
      toast('Dismissed — not a trackable shipment')
      navigate('/review-queue')
    } catch (err) {
      await handleStale(err)
    }
  }

  const onSaveAndApprove = async (payload: ReviewCardSavePayload) => {
    setStaleBanner(null)
    try {
      const fields = payload.fields
      const mapped = mapCriticFieldsToColumns(fields)
      const hasFields = Object.keys(fields).length > 0
      const hasMappable = Object.keys(mapped).length > 0
      if (hasFields && !hasMappable) {
        // Contested keys that do not map to leg columns — saving here would silently drop them.
        toast('Those conflict fields cannot be saved here — open the full shipment to edit.')
        return
      }
      if (hasMappable) {
        await correctMutation.mutateAsync({
          shipmentId: shipment.id,
          fields: mapped,
          reason: payload.note,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? shipment.updatedAt,
        })
      } else {
        await confirmMutation.mutateAsync({
          shipmentId: shipment.id,
          note: payload.note || undefined,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? shipment.updatedAt,
        })
      }
      toast('Shipment approved')
      navigate(backToShipment)
    } catch (err) {
      await handleStale(err)
    }
  }

  return (
    <div className="space-y-5" data-testid="shipment-review-focus">
      <div>
        {backButton}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-text-primary">
              Review{' '}
              <span className="font-mono text-cobalt-primary-light">{bookingLabel}</span>
            </h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {shipment.customer?.name ?? 'Unknown Customer'}
              {shipment.forwarder?.name && ` · ${shipment.forwarder.name}`}
              {shipment.route && ` · ${shipment.route}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="status" value={shipment.status} />
            <Link
              to={backToShipment}
              className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-600 hover:text-text-primary"
            >
              Open full shipment
            </Link>
          </div>
        </div>
      </div>

      {readOnly && (
        <div className="rounded-lg border border-border bg-surface-900/40 px-3 py-2 text-xs text-text-muted">
          This shipment is no longer awaiting review — shown read-only.
        </div>
      )}

      {staleBanner && (
        <div className="flex items-center gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <AlertTriangle size={13} className="shrink-0" />
          {staleBanner}
        </div>
      )}

      <Card>
        <ReviewCard
          shipment={shipment}
          criticReview={shipment.criticReview ?? null}
          emails={shipment.emails ?? []}
          fullShipmentPath={backToShipment}
          defaultExpanded
          embedded
          readOnly={readOnly}
          onApprove={readOnly ? undefined : onApprove}
          onDismiss={readOnly ? undefined : onDismiss}
          onSaveAndApprove={readOnly ? undefined : onSaveAndApprove}
          onIdentify={
            readOnly
              ? undefined
              : async (field, value) => identifyMutation.mutateAsync({ shipmentId: shipment.id, field, value })
          }
          onLink={
            readOnly
              ? undefined
              : async (targetShipmentId) => {
                  await linkMutation.mutateAsync({ shipmentId: shipment.id, targetShipmentId })
                }
          }
        />
      </Card>
    </div>
  )
}
