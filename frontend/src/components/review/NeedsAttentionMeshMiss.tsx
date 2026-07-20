import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { NeedsAttentionItem } from './needs-attention'
import { isExpandableMiss, isMeshPortCollapsed } from './needs-attention'
import { cn } from '../../lib/utils'
import { REVIEW_PANEL_DOT, REVIEW_PANEL_ITEM } from './review-table-layout'

/**
 * Expandable master-miss summary: multi-party Mesh miss or multi-port UN/LOCODE miss.
 * One summary bullet; expand to list each name/token.
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
  if (!isExpandableMiss(item)) return null

  const names = item.details ?? []
  const n = names.length
  const isPort = isMeshPortCollapsed(item)
  const showLabel = open
    ? isPort
      ? 'Hide ports'
      : 'Hide names'
    : isPort
      ? `Show ${n} ports`
      : `Show ${n} names`
  const rowSuffix = isPort ? ' — not in UN/LOCODE masters' : ' — not in Mesh'
  const testId = isPort ? 'mesh-port-collapsed' : 'mesh-party-collapsed'
  const expandTestId = isPort ? 'mesh-port-expand' : 'mesh-party-expand'
  const detailsTestId = isPort ? 'mesh-port-details' : 'mesh-party-details'

  return (
    <li className={cn('list-none', className)} data-testid={testId}>
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
            data-testid={expandTestId}
          >
            {open ? (
              <ChevronDown size={14} className="mt-0.5 shrink-0 text-text-muted" />
            ) : (
              <ChevronRight size={14} className="mt-0.5 shrink-0 text-text-muted" />
            )}
            <span className="min-w-0">
              {item.text}
              <span className="ml-1.5 text-xs font-medium text-cobalt-primary-light">
                {showLabel}
              </span>
            </span>
          </button>
          {open && (
            <ul
              className={cn(
                'mt-1.5 space-y-1 border-l border-border pl-3 ml-1',
                listClassName,
              )}
              data-testid={detailsTestId}
            >
              {names.map((name) => (
                <li key={name} className="text-sm leading-snug text-text-secondary">
                  <span className="font-mono text-text-primary">{name}</span>
                  <span className="text-text-muted">{rowSuffix}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}
