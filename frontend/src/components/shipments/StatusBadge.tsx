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
  RELEASED: 'bg-state-released',
  DELIVERED: 'bg-state-delivered',
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className={cn('h-2 w-2 rounded-full', dotColors[status] ?? 'bg-text-muted')} />
      <span className="text-text-primary">{status.replace('_', ' ')}</span>
    </span>
  )
}
