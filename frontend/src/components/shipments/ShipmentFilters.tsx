import { cn, stateLabel } from '../../lib/utils'

interface StatusFilterProps {
  value: string
  onChange: (v: string) => void
}

const statuses = ['ALL', 'BOOKED', 'CONFIRMED', 'AT_WAREHOUSE', 'SAILED', 'RELEASED', 'DELIVERED']

export function ShipmentFilters({ value, onChange }: StatusFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {statuses.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            value === s
              ? 'bg-cobalt-primary text-white'
              : 'bg-surface-700 text-text-secondary hover:bg-surface-600 hover:text-text-primary',
          )}
        >
          {s === 'ALL' ? 'All' : stateLabel(s)}
        </button>
      ))}
    </div>
  )
}
