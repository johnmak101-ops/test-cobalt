import { cn, stateLabel } from '../lib/utils'

const styles: Record<string, string> = {
  BOOKED: 'bg-state-booked/15 text-state-booked',
  CONFIRMED: 'bg-state-confirmed/15 text-state-confirmed',
  AT_WAREHOUSE: 'bg-state-warehouse/15 text-state-warehouse',
  SAILED: 'bg-state-sailed/15 text-state-sailed',
  RELEASED: 'bg-state-released/15 text-state-released',
  DELIVERED: 'bg-state-delivered/15 text-state-delivered',
}

export function StateBadge({ state }: { state: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide',
        styles[state] ?? 'bg-surface-700 text-text-muted',
      )}
    >
      {stateLabel(state)}
    </span>
  )
}
