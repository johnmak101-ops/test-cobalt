import { cn } from '../../lib/utils'
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  padding?: boolean
}

export function Card({ children, className, padding = true }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-800',
        padding && 'p-5',
        className
      )}
    >
      {children}
    </div>
  )
}
