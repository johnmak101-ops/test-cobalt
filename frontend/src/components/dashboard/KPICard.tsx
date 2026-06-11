import { cn } from '../../lib/utils'
import type { LucideIcon } from 'lucide-react'

interface KPICardProps {
  icon: LucideIcon
  label: string
  value: number
  color: string
  onClick?: () => void
}

export function KPICard({ icon: Icon, label, value, color, onClick }: KPICardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group flex items-center gap-4 rounded-xl border border-border bg-surface-800 p-5 transition-all hover:border-border-light hover:shadow-lg hover:shadow-black/20',
        onClick && 'cursor-pointer'
      )}
    >
      <div
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          color
        )}
      >
        <Icon size={20} />
      </div>
      <div>
        <p className="text-3xl font-semibold tabular-nums text-text-primary">{value}</p>
        <p className="text-xs font-medium text-text-muted">{label}</p>
      </div>
    </div>
  )
}
