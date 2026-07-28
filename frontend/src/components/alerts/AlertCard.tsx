import { Badge } from '../ui/Badge'
import { parsePONumbers, formatPoHeader, formatRelativeTime, formatShipmentId } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { useMarkAlertRead, useMarkAlertUnread } from '../../hooks/use-alerts'
import { MailOpen } from 'lucide-react'
import { cn } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'
import { DESK_ROW_BODY, DESK_ROW_HEAD, DESK_ROW_META, DESK_ROW_TIME } from '../dashboard/desk-row'

interface AlertCardProps {
  alert: {
    id: string
    shipmentId: string
    ruleId: string
    severity: string
    message: string
    status: string
    triggeredAt: string
    readAt?: string | null
    shipment?: {
      id: string
      poNumbers: string
      route: string | null
      consigneeName?: string | null
      customer?: { name: string } | null
      /** #350: anchor fields for the derived Shipment ID (firstEmailAt ?? createdAt). */
      firstEmailAt?: string | null
      createdAt?: string | null
    }
  }
  compact?: boolean
}

const severityBorder: Record<string, string> = {
  CRITICAL: 'border-l-status-critical',
  WARNING: 'border-l-status-warning',
  INFO: 'border-l-status-info',
}

export function AlertCard({ alert, compact }: AlertCardProps) {
  const navigate = useNavigate()
  const markRead = useMarkAlertRead()
  const markUnread = useMarkAlertUnread()

  const isRead = !!alert.readAt
  const poHeader = alert.shipment ? formatPoHeader(parsePONumbers(alert.shipment.poNumbers)) : null
  const route = alert.shipment?.route?.trim() || null
  const consignee = alert.shipment?.consigneeName?.trim() || null
  // #348/#350: lead with the derived Shipment ID — the same identity the tracker + detail title show.
  const shipmentIdLabel = alert.shipment
    ? formatShipmentId(alert.shipment.id, alert.shipment.firstEmailAt ?? alert.shipment.createdAt)
    : null

  const titleParts = [shipmentIdLabel, poHeader, route].filter(Boolean)
  const title = titleParts.length > 0 ? titleParts.join(' | ') : null

  const openAlert = () => {
    // Like inbox: opening an item marks it read, then go to the shipment.
    if (!isRead) markRead.mutate(alert.id)
    if (alert.shipmentId) {
      navigate(`/shipments/${alert.shipmentId}`, { state: { fromAlerts: true } })
    }
  }

  return (
    <div
      {...interactiveProps(openAlert)}
      className={cn(
        'cursor-pointer rounded-lg border border-border border-l-4 bg-surface-800 transition-colors hover:bg-surface-700',
        severityBorder[alert.severity],
        isRead && 'opacity-60',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Compact = the dashboard band, where this row is read across against a Review Queue row,
              so its height is reserved rather than earned (desk-row.ts). Full size keeps its natural
              flow: on the Alerts page a clamped message would hide the point of the alert. */}
          <div className={compact ? DESK_ROW_HEAD : 'flex min-w-0 flex-wrap items-center gap-2'}>
            {!isRead && (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-cobalt-primary"
                title="Unread"
                aria-hidden
              />
            )}
            <Badge variant="severity" value={alert.severity} />
            {title && (
              <span
                className={cn(
                  'min-w-0 truncate font-mono text-sm',
                  isRead ? 'font-normal text-text-secondary' : 'font-medium text-text-primary',
                )}
              >
                {title}
              </span>
            )}
          </div>
          {/* Compact always renders this line, empty or not — an alert without a consignee must not
              come out a line shorter than the review row it sits beside. */}
          {compact ? (
            <p className={DESK_ROW_META}>{consignee ?? ''}</p>
          ) : (
            consignee && <p className="mt-0.5 truncate text-xs text-text-muted">{consignee}</p>
          )}
          <p
            className={cn(
              compact ? DESK_ROW_BODY : 'mt-1.5 text-sm',
              isRead ? 'text-text-muted' : 'text-text-secondary',
            )}
          >
            {/* Backend builds a live message from rule thresholds + leg facts (not a static seed blurb). */}
            {alert.message}
          </p>
          <p className={compact ? DESK_ROW_TIME : 'mt-1 text-xs text-text-muted'}>
            {formatRelativeTime(alert.triggeredAt)}
          </p>
        </div>

        {/* Explicit mark-as-unread only (read happens on open, like email). */}
        {!compact && isRead && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              markUnread.mutate(alert.id)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface-700 px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-cobalt-primary/40 hover:bg-surface-600 hover:text-text-primary"
            title="Mark as unread"
            aria-label="Mark as unread"
          >
            <MailOpen size={14} />
            <span>Mark unread</span>
          </button>
        )}
      </div>
    </div>
  )
}
