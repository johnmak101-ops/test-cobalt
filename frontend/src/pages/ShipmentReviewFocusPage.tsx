import { useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { useShipment } from '../hooks/use-shipments'
import { useParties } from '../hooks/use-parties'
import {
  useConfirmShipment,
  useCorrectShipment,
  useDismissShipments,
  useIdentifyShipment,
  useLinkShipment,
  useWaitShipment,
  isStaleConflict,
} from '../hooks/use-review-queue'
import { ReviewCard, type ReviewCardSavePayload } from '../components/review/ReviewCard'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { keptSuffix, mapCriticFieldsToColumns } from '../lib/review-fields'
import { formatShipmentId } from '../lib/utils'
import { toast } from '../components/ui/Toast'

/**
 * Focused, deep-linkable review view for ONE shipment (/review-queue/:id).
 *
 * The shipment detail page's "see conflict table" and "Review & approve" CTAs land here instead of
 * dumping the operator on the queue's landing page (where the row was often paginated out or below
 * the fold). It reuses the queue's presentational ReviewCard — the conflict table + Leave As Is /
 * Approve — so there is still ONE conflict UI. The approve/correct wiring mirrors the queue's
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
  const identifyMutation = useIdentifyShipment()
  const linkMutation = useLinkShipment()
  const dismissMutation = useDismissShipments()
  const waitMutation = useWaitShipment()

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

  /**
   * The Mesh mirror. The card turns an unlinked party into a conflict-table row and offers these as
   * its candidates; it must not fetch them itself — ReviewCard must stay renderable
   * without a QueryClient, as 134 of its tests do.
   *
   * Declared BEFORE the loading/error early returns: hooks cannot sit behind a conditional.
   */
  const { data: customerMasters } = useParties('customer')
  const { data: vendorMasters } = useParties('vendor')
  const { data: forwarderMasters } = useParties('forwarder')
  const partyMasters = useMemo(
    () => [...(customerMasters ?? []), ...(vendorMasters ?? []), ...(forwarderMasters ?? [])],
    [customerMasters, vendorMasters, forwarderMasters],
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
  // Title identity matches ShipmentDetailPage (#348/#350/#355): the derived Shipment ID, anchored
  // to the beginning email, with #151's leg ordinal riding it. This page used to lead with the
  // booking number, so the same leg answered to two different names depending on which surface
  // you opened. The booking moves to the subtitle — it is the only place it appears here (the
  // ReviewCard prints it in its COLLAPSED header, which this page never renders).
  const shipmentIdValue =
    formatShipmentId(shipment.id, shipment.firstEmailAt ?? shipment.createdAt) +
    ((shipment.legCount ?? 1) > 1 ? ` · Leg ${shipment.legNo ?? 1}/${shipment.legCount}` : '')
  const bookingLabel = shipment.bookingNo ?? shipment.soNumber ?? null

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

  /** "No" — not a trackable shipment. Same endpoint the queue's bulk select uses, for one leg. */
  const onReject = async (note?: string) => {
    setStaleBanner(null)
    try {
      await dismissMutation.mutateAsync({ shipmentIds: [shipment.id], note })
      toast('Rejected — not a trackable shipment')
      navigate('/review-queue')
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API error \d+:\s*/i, '') : 'Reject failed'
      toast.error(msg || 'Reject failed — try again')
    }
  }

  /** "Not yet" — park it; the note (if any) records what is being waited on. */
  const onWait = async (reason?: string) => {
    setStaleBanner(null)
    try {
      await waitMutation.mutateAsync({ shipmentId: shipment.id, reason })
      toast(reason ? `Parked as waiting — ${reason}` : 'Parked as waiting')
      navigate('/review-queue')
    } catch (err) {
      const msg = err instanceof Error ? err.message.replace(/^API error \d+:\s*/i, '') : 'Park failed'
      toast.error(msg || 'Park failed — try again')
    }
  }

  const onSaveAndApprove = async (payload: ReviewCardSavePayload) => {
    setStaleBanner(null)
    try {
      const fields = payload.fields
      const mapped = mapCriticFieldsToColumns(fields)
      const keep = payload.keep ?? []
      const hasFields = Object.keys(fields).length > 0
      const hasMappable = Object.keys(mapped).length > 0
      if (hasFields && !hasMappable) {
        // Contested keys that do not map to leg columns — saving here would silently drop them.
        toast.error('Those conflict fields cannot be saved here — open the full shipment to edit.')
        return
      }
      if (hasMappable) {
        const res = await correctMutation.mutateAsync({
          shipmentId: shipment.id,
          fields: mapped,
          keep,
          reason: payload.note,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? shipment.updatedAt,
        })
        const corrected = (res as { corrected?: string[] } | undefined)?.corrected
        const n = Array.isArray(corrected) ? corrected.length : Object.keys(mapped).length
        if (n === 0) {
          toast.error('Approved, but no fields were written — reload and try Approve again')
        } else {
          toast(`Saved ${n} field${n === 1 ? '' : 's'} and approved${keptSuffix(keep)}`)
        }
      } else {
        await confirmMutation.mutateAsync({
          shipmentId: shipment.id,
          note: payload.note || undefined,
          keep,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? shipment.updatedAt,
        })
        // "no field changes" is true of the values and false about the click when a row was ruled —
        // a keep writes nothing but does lock the field.
        toast(
          keep.length
            ? `Approved — kept ${keep.length} stored value${keep.length === 1 ? '' : 's'} as ruled`
            : 'Shipment approved (no field changes)',
        )
      }
      navigate(backToShipment)
    } catch (err) {
      try {
        await handleStale(err)
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Save failed'
        toast.error(msg.replace(/^API error \d+:\s*/i, '') || 'Save failed — try again')
      }
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
              <span className="font-mono text-cobalt-primary-light">{shipmentIdValue}</span>
            </h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {shipment.customer?.name ?? 'Unknown Customer'}
              {shipment.forwarder?.name && ` · ${shipment.forwarder.name}`}
              {shipment.route && ` · ${shipment.route}`}
              {bookingLabel && ` · ${bookingLabel}`}
            </p>
          </div>
          {/* No "Open full shipment" here — the review card below carries its own Open shipment
              link, and the header duplicated it two clicks from the same place. */}
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="status" value={shipment.status} />
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
          partyMasters={partyMasters}
          criticReview={shipment.criticReview ?? null}
          emails={shipment.emails ?? []}
          defaultExpanded
          embedded
          readOnly={readOnly}
          onApprove={readOnly ? undefined : onApprove}
          onSaveAndApprove={readOnly ? undefined : onSaveAndApprove}
          onReject={readOnly ? undefined : onReject}
          onWait={readOnly ? undefined : onWait}
          onIdentify={
            readOnly
              ? undefined
              : async (field, value) => identifyMutation.mutateAsync({ shipmentId: shipment.id, field, value })
          }
          onLink={
            readOnly
              ? undefined
              : async (targetShipmentId, payload) => {
                  try {
                    const fields = payload?.fields
                      ? mapCriticFieldsToColumns(payload.fields)
                      : undefined
                    await linkMutation.mutateAsync({
                      shipmentId: shipment.id,
                      targetShipmentId,
                      fields,
                      reason: payload?.note,
                    })
                    toast.success('Linked & applied — opening shipment')
                    navigate(`/shipments/${targetShipmentId}`, { state: { fromReview: true } })
                  } catch (e) {
                    const msg =
                      e instanceof Error
                        ? e.message.replace(/^API error \d+:\s*/i, '')
                        : 'Link failed'
                    toast.error(msg || 'Link failed')
                    throw e
                  }
                }
          }
        />
      </Card>
    </div>
  )
}
