import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { NeedsAttentionItem } from './needs-attention'
import { isMeshPartyCollapsed } from './needs-attention'
import { cn } from '../../lib/utils'
import { REVIEW_PANEL_DOT, REVIEW_PANEL_ITEM } from './review-table-layout'

/**
 * Mesh multi-party miss: one summary bullet, expand to list each party name.
 */
export function NeedsAttentionMeshMiss({
  item,
  className,
  listClassName,
}: {
  item: NeedsAttentionItem
  className?: string
  /** Class for expanded name rows (detail page uses list-disc; review uses panel item). */
  listClassName?: string
}) {
  const [open, setOpen] = useState(false)
  if (!isMeshPartyCollapsed(item)) return null

  const names = item.details ?? []
  const n = names.length

  return (
    <li className={cn('list-none', className)} data-testid="mesh-party-collapsed">
      <div className={cn(REVIEW_PANEL_ITEM, 'items-start')}>
        <span
          className={cn(
            REVIEW_PANEL_DOT,
            item.severity === 'high'
              ? 'bg-status-critical'
              : item.severity === 'medium'
                ? 'bg-status-warning'
                : 'bg-surface-600',
          )}
        />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex w-full min-w-0 items-start gap-1.5 text-left text-sm leading-snug text-text-secondary hover:text-text-primary"
            data-testid="mesh-party-expand"
          >
            {open ? (
              <ChevronDown size={14} className="mt-0.5 shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={14} className="mt-0.5 shrink-0 text-text-muted" />
            )}
            <span className="min-w-0">
              {item.text}
              <span className="ml-1.5 text-xs font-medium text-cobalt-primary-light">
                {open ? 'Hide names' : `Show ${n} names`}
              </span>
            </span>
          </button>
          {open && (
            <ul
              className={cn(
                'mt-1.5 space-y-1 border-l border-border pl-3 ml-1',
                listClassName,
              )}
              data-testid="mesh-party-details"
            >
              {names.map((name) => (
                <li key={name} className="text-sm leading-snug text-text-secondary">
                  <span className="font-mono text-text-primary">{name}</span>
                  <span className="text-text-muted"> — not in Mesh</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}
