import { Badge } from '../ui/Badge'
import { parsePONumbers, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { useMarkAlertRead, useMarkAlertUnread } from '../../hooks/use-alerts'
import { CheckCircle, CircleDot } from 'lucide-react'
import { cn } from '../../lib/utils'

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

export function AlertCard({ alert, compact }: AlertCardProps) {
  const navigate = useNavigate()
  const markRead = useMarkAlertRead()
  const markUnread = useMarkAlertUnread()

  const isRead = !!alert.readAt
  const poNumbers = alert.shipment ? parsePONumbers(alert.shipment.poNumbers) : []

  return (
    <div
      onClick={() => navigate(`/shipments/${alert.shipmentId}`, { state: { fromAlerts: true } })}
      className={cn(
        'cursor-pointer rounded-lg border border-border border-l-4 bg-surface-800 transition-colors hover:bg-surface-700',
        severityBorder[alert.severity],
        isRead && 'opacity-50',
        compact ? 'p-3' : 'p-4'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="severity" value={alert.severity} />
            {poNumbers.length > 0 && (
              <span className="font-mono text-sm text-text-primary">
                PO# {poNumbers.join(', ')}
              </span>
            )}
            {alert.shipment?.customer && (
              <span className="text-sm text-text-secondary">
                {alert.shipment.customer.name}
              </span>
            )}
            {isRead && (
              <span className="text-xs text-text-muted">(read)</span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-text-secondary">{alert.message}</p>
          <p className="mt-1 text-xs text-text-muted">
            {formatRelativeTime(alert.triggeredAt)}
            {alert.shipment?.route && ` · ${alert.shipment.route}`}
          </p>
        </div>

        {!compact && (
          <button
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
              isRead
                ? 'hover:text-status-warning'
                : 'hover:text-status-success'
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
