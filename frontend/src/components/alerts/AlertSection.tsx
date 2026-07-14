import { AlertCard } from './AlertCard'

interface Alert {
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

interface AlertSectionProps {
  severity: string
  alerts: Alert[]
}

const severityLabels: Record<string, string> = {
  CRITICAL: 'Critical',
  WARNING: 'Warning',
  INFO: 'Info',
}

const severityIcons: Record<string, string> = {
  CRITICAL: '🔴',
  WARNING: '⚠️',
  INFO: 'ℹ️',
}

export function AlertSection({ severity, alerts }: AlertSectionProps) {
  if (alerts.length === 0) return null

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <span>{severityIcons[severity]}</span>
        <span>{severityLabels[severity]}</span>
        <span className="text-text-muted">({alerts.length})</span>
      </h3>
      <div className="space-y-2">
        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} />
        ))}
      </div>
    </div>
  )
}
