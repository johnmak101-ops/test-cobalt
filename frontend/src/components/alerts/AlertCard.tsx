import { Badge } from '../ui/Badge'
import { parsePONumbers, formatRelativeTime } from '../../lib/utils'
import { useNavigate } from 'react-router-dom'
import { useDismissAlert, useSnoozeAlert } from '../../hooks/use-alerts'
import { Eye, X, Clock } from 'lucide-react'
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
  const dismiss = useDismissAlert()
  const snooze = useSnoozeAlert()

  const poNumbers = alert.shipment ? parsePONumbers(alert.shipment.poNumbers) : []

  return (
    <div
      className={cn(
        'rounded-lg border border-border border-l-4 bg-surface-800',
        severityBorder[alert.severity],
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
          </div>
          <p className="mt-1.5 text-sm text-text-secondary">{alert.message}</p>
          <p className="mt-1 text-xs text-text-muted">
            {formatRelativeTime(alert.triggeredAt)}
            {alert.shipment?.route && ` · ${alert.shipment.route}`}
          </p>
        </div>

        {!compact && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => navigate(`/shipments/${alert.shipmentId}`)}
              className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
              title="View Shipment"
            >
              <Eye size={14} />
            </button>
            <button
              onClick={() => snooze.mutate({ id: alert.id, hours: 24 })}
              className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-text-primary"
              title="Snooze 24h"
            >
              <Clock size={14} />
            </button>
            <button
              onClick={() => dismiss.mutate(alert.id)}
              className="rounded-md p-1.5 text-text-muted hover:bg-surface-700 hover:text-status-critical"
              title="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
