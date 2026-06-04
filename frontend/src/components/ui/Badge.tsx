import { cn } from '../../lib/utils'

const severityStyles: Record<string, string> = {
  CRITICAL: 'bg-status-critical/15 text-status-critical border-status-critical/30',
  WARNING: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  INFO: 'bg-status-info/15 text-status-info border-status-info/30',
  SUCCESS: 'bg-status-success/15 text-status-success border-status-success/30',
}

const statusStyles: Record<string, string> = {
  BOOKED: 'bg-state-booked/15 text-state-booked border-state-booked/30',
  CONFIRMED: 'bg-state-confirmed/15 text-state-confirmed border-state-confirmed/30',
  AT_WAREHOUSE: 'bg-state-warehouse/15 text-state-warehouse border-state-warehouse/30',
  SAILED: 'bg-state-sailed/15 text-state-sailed border-state-sailed/30',
  RELEASED: 'bg-state-released/15 text-state-released border-state-released/30',
  DELIVERED: 'bg-state-delivered/15 text-state-delivered border-state-delivered/30',
}

const emailTypeStyles: Record<string, string> = {
  BOOKING_REQUEST: 'bg-state-booked/15 text-state-booked',
  SHIPPING_ORDER: 'bg-state-confirmed/15 text-state-confirmed',
  DRAFT_BL: 'bg-state-warehouse/15 text-state-warehouse',
  FINAL_BL: 'bg-state-sailed/15 text-state-sailed',
  TELEX_RELEASE: 'bg-state-released/15 text-state-released',
  OTHER: 'bg-surface-700 text-text-muted',
}

const emailTypeLabels: Record<string, string> = {
  BOOKING_REQUEST: 'BOOKING',
  SHIPPING_ORDER: 'SO',
  DRAFT_BL: 'DRAFT B/L',
  FINAL_BL: 'FINAL B/L',
  TELEX_RELEASE: 'TELEX',
  DELAY_NOTICE: 'DELAY',
  OTHER: 'UNCLASSIFIED',
}

interface BadgeProps {
  variant?: 'severity' | 'status' | 'emailType'
  value: string
  className?: string
}

export function Badge({ variant = 'severity', value, className }: BadgeProps) {
  const styles =
    variant === 'status'
      ? statusStyles
      : variant === 'emailType'
        ? emailTypeStyles
        : severityStyles

  const label = variant === 'emailType' ? emailTypeLabels[value] ?? value : value
  const displayLabel = variant === 'status' ? value.replace('_', ' ') : label

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
        styles[value] ?? 'bg-surface-700 text-text-muted border-border',
        className
      )}
    >
      {displayLabel}
    </span>
  )
}
