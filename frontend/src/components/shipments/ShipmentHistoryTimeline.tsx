import { formatDate, formatRelativeTime } from '../../lib/utils'
import { cn } from '../../lib/utils'
import type { HistoryEntry } from '../../hooks/use-shipment-history'
import {
  Clock,
  Mail,
  User,
  Settings,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'

const fieldLabels: Record<string, string> = {
  etd: 'ETD',
  eta: 'ETA',
  vessel_name: 'Vessel',
  status: 'Status',
  cfs_cutoff: 'CFS Cutoff',
  hbl_number: 'HBL#',
  voyage_number: 'Voyage#',
  quantity_shipped: 'Qty Shipped',
  risk_level: 'Risk Level',
}

const sourceIcons = {
  email: Mail,
  manual: User,
  system: Settings,
}

const sourceLabels = {
  email: 'Email extraction',
  manual: 'Manual edit',
  system: 'System',
}

interface ShipmentHistoryTimelineProps {
  history: HistoryEntry[]
}

export function ShipmentHistoryTimeline({ history }: ShipmentHistoryTimelineProps) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <Clock size={24} className="mb-2 opacity-50" />
        <p className="text-sm">No changes recorded yet</p>
      </div>
    )
  }

  return (
    <div className="relative space-y-0">
      {/* Timeline line */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

      {history.map((entry) => {
        const SourceIcon = sourceIcons[entry.sourceType] ?? Settings

        return (
          <div key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Timeline dot */}
            <div
              className={cn(
                'relative z-10 mt-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border',
                entry.isDelay
                  ? 'border-status-critical/40 bg-status-critical/15'
                  : 'border-border bg-surface-700'
              )}
            >
              {entry.isDelay ? (
                <AlertTriangle size={13} className="text-status-critical" />
              ) : (
                <SourceIcon size={13} className="text-text-muted" />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {fieldLabels[entry.field] ?? entry.field}
                </span>
                {entry.isDelay && (
                  <span className="rounded bg-status-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
                    DELAY
                  </span>
                )}
              </div>

              {/* Old → New value */}
              <div className="mt-1 flex items-center gap-1.5 text-xs">
                <span className="text-text-muted line-through">
                  {formatFieldValue(entry.field, entry.oldValue)}
                </span>
                <ArrowRight size={10} className="shrink-0 text-text-muted" />
                <span className="font-medium text-text-secondary">
                  {formatFieldValue(entry.field, entry.newValue)}
                </span>
              </div>

              {/* Source + time */}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                <span>{sourceLabels[entry.sourceType] ?? entry.sourceType}</span>
                <span>·</span>
                <span>{formatRelativeTime(entry.changedAt)}</span>
              </div>

              {entry.notes && (
                <p className="mt-1 text-xs italic text-text-muted">{entry.notes}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatFieldValue(field: string, value: string | null): string {
  if (!value) return '(empty)'

  // Date fields
  if (['etd', 'eta', 'cfs_cutoff'].includes(field)) {
    try {
      return formatDate(value)
    } catch {
      return value
    }
  }

  // Status: make readable
  if (field === 'status' || field === 'risk_level') {
    return value.replace(/_/g, ' ')
  }

  return value
}
