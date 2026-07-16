import { cn } from '../../lib/utils'
import { bandLabel, type Band } from '../../lib/critic-review'

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
  DEPARTED: 'bg-state-released/15 text-state-released border-state-released/30',
  ARRIVED: 'bg-state-delivered/15 text-state-delivered border-state-delivered/30',
  CANCELLED: 'bg-status-critical/15 text-status-critical border-status-critical/30',
}

// Every variant carries an explicit border colour. The base class sets `border` (width only), and
// Tailwind v4 defaults border-color to currentColor — so a variant that omits one renders a hard
// full-strength outline instead of the /30 tint every other badge uses.
const emailTypeStyles: Record<string, string> = {
  BOOKING_REQUEST: 'bg-state-booked/15 text-state-booked border-state-booked/30',
  SHIPPING_ORDER: 'bg-state-confirmed/15 text-state-confirmed border-state-confirmed/30',
  DRAFT_BL: 'bg-state-warehouse/15 text-state-warehouse border-state-warehouse/30',
  FINAL_BL: 'bg-state-sailed/15 text-state-sailed border-state-sailed/30',
  DEPARTURE_NOTICE: 'bg-state-released/15 text-state-released border-state-released/30',
  OTHER: 'bg-surface-700 text-text-muted border-border',
}

/** Confidence band → severity tokens (low=critical, medium=warning, high=success). */
const confidenceStyles: Record<string, string> = {
  low: 'bg-status-critical/15 text-status-critical border-status-critical/30',
  medium: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  high: 'bg-status-success/15 text-status-success border-status-success/30',
}

const emailTypeLabels: Record<string, string> = {
  BOOKING_REQUEST: 'BOOKING',
  SHIPPING_ORDER: 'SO',
  DRAFT_BL: 'DRAFT BOL',
  FINAL_BL: 'FINAL BOL',
  DEPARTURE_NOTICE: 'DEPARTURE',
  DELAY_NOTICE: 'DELAY',
  OTHER: 'UNCLASSIFIED',
}

/** The ONE status→label vocabulary (document-stage terminology) — badges, PO progress labels, exports. */
export const statusLabels: Record<string, string> = {
  BOOKED: 'Booking Request',
  CONFIRMED: 'SO Received',
  AT_WAREHOUSE: 'Draft BOL',
  SAILED: 'Final BOL',
  DEPARTED: 'Departure',
  ARRIVED: 'Delivered',
  CANCELLED: 'Cancelled',
}

interface BadgeProps {
  variant?: 'severity' | 'status' | 'emailType' | 'confidence'
  value: string
  className?: string
}

function stylesFor(variant: NonNullable<BadgeProps['variant']>): Record<string, string> {
  if (variant === 'status') return statusStyles
  if (variant === 'emailType') return emailTypeStyles
  if (variant === 'confidence') return confidenceStyles
  return severityStyles
}

function displayLabelFor(variant: NonNullable<BadgeProps['variant']>, value: string): string {
  if (variant === 'emailType') return emailTypeLabels[value] ?? value
  if (variant === 'status') return statusLabels[value] ?? value.replace('_', ' ')
  if (variant === 'confidence' && (value === 'low' || value === 'medium' || value === 'high')) {
    return bandLabel(value as Band)
  }
  return value
}

export function Badge({ variant = 'severity', value, className }: BadgeProps) {
  const styles = stylesFor(variant)
  const displayLabel = displayLabelFor(variant, value)

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
