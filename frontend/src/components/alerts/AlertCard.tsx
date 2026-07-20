import { Badge } from '../ui/Badge'
import { parsePONumbers, formatPoHeader, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { useMarkAlertRead, useMarkAlertUnread } from '../../hooks/use-alerts'
import { CheckCircle, CircleDot } from 'lucide-react'
import { cn } from '../../lib/utils'
import { interactiveProps } from '../../lib/interactive'

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
    }
  }
  compact?: boolean
}

const severityBorder: Record<string, string> = {
  CRITICAL: 'border-l-status-critical',
  WARNING: 'border-l-status-warning',
  INFO: 'border-l-status-info',
}

/** POC operator next-step hints by rule id (frontend map; no DB column required). */
const ACTION_BY_RULE: Record<string, string> = {
  A1: 'Contact forwarder for SO / booking confirmation',
  A2: 'Verify truck scheduled for warehouse delivery',
  A3: 'Contact forwarder to confirm cargo status',
  A4: 'Chase Final B/L with forwarder',
  A5: 'Confirm freight payment / telex release',
  A6: 'Confirm delivery / in-DC with consignee',
  A7: 'Confirm cargo-ready revision with forwarder',
}

export function AlertCard({ alert, compact }: AlertCardProps) {
  const navigate = useNavigate()
  const markRead = useMarkAlertRead()
  const markUnread = useMarkAlertUnread()

  const isRead = !!alert.readAt
  const poHeader = alert.shipment ? formatPoHeader(parsePONumbers(alert.shipment.poNumbers)) : null
  const route = alert.shipment?.route?.trim() || null
  const consignee = alert.shipment?.consigneeName?.trim() || null
  const action = ACTION_BY_RULE[alert.ruleId]

  const titleParts = [poHeader, route].filter(Boolean)
  const title = titleParts.length > 0 ? titleParts.join(' | ') : null

  return (
    <div
      {...interactiveProps(() =>
        navigate(`/shipments/${alert.shipmentId}`, { state: { fromAlerts: true } }),
      )}
      className={cn(
        'cursor-pointer rounded-lg border border-border border-l-4 bg-surface-800 transition-colors hover:bg-surface-700',
        severityBorder[alert.severity],
        isRead && 'opacity-50',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="severity" value={alert.severity} />
            {title && (
              <span className="min-w-0 truncate font-mono text-sm font-medium text-text-primary">
                {title}
              </span>
            )}
            {isRead && <span className="shrink-0 text-xs text-text-muted">(read)</span>}
          </div>
          {consignee && (
            <p className="mt-0.5 truncate text-xs text-text-muted">{consignee}</p>
          )}
          <p className="mt-1.5 text-sm text-text-secondary">{alert.message}</p>
          {action && !compact && (
            <p className="mt-2 text-xs text-text-muted">
              <span className="font-semibold text-text-secondary">Action:</span> {action}
            </p>
          )}
          <p className="mt-1 text-xs text-text-muted">{formatRelativeTime(alert.triggeredAt)}</p>
        </div>

        {!compact && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (isRead) {
                markUnread.mutate(alert.id)
              } else {
                markRead.mutate(alert.id)
              }
            }}
            className={cn(
              'shrink-0 rounded-md p-1.5 text-text-muted hover:bg-surface-600',
              isRead ? 'hover:text-status-warning' : 'hover:text-status-success',
            )}
            title={isRead ? 'Mark as Unread' : 'Mark as Read'}
          >
            {isRead ? <CircleDot size={14} /> : <CheckCircle size={14} />}
          </button>
        )}
      </div>
    </div>
  )
}
