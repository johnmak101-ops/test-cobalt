import { cn } from '../../lib/utils'

interface StatusBadgeProps {
  status: string
  className?: string
}

const dotColors: Record<string, string> = {
  BOOKED: 'bg-state-booked',
  CONFIRMED: 'bg-state-confirmed',
  AT_WAREHOUSE: 'bg-state-warehouse',
  SAILED: 'bg-state-sailed',
  DEPARTED: 'bg-state-released',
  ARRIVED: 'bg-state-delivered',
  CANCELLED: 'bg-status-critical',
}

const statusLabels: Record<string, string> = {
  BOOKED: 'Booking Request',
  CONFIRMED: 'SO Received',
  AT_WAREHOUSE: 'Draft BOL',
  SAILED: 'Final BOL',
  DEPARTED: 'Departure',
  ARRIVED: 'Delivered',
  CANCELLED: 'Cancelled',
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('h-2 w-2 rounded-full', dotColors[status] ?? 'bg-text-muted')} />
      <span className="text-text-primary">{statusLabels[status] ?? status.replace('_', ' ')}</span>
    </span>
  )
}
