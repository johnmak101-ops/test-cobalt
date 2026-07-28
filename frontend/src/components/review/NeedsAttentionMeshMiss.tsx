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
  onPick,
  picking,
}: {
  item: NeedsAttentionItem
  className?: string
  /** Class for expanded name rows (detail page uses list-disc; review uses panel item). */
  listClassName?: string
  /**
   * Link a raw party name to one of the Mesh masters it appears to name. Omitted on surfaces with
   * no write path (the shipment detail page reads the same items), which simply list the candidates.
   */
  onPick?: (partyName: string, masterName: string) => void
  /** The party name currently being written, so its buttons can disable without freezing the list. */
  picking?: string | null
}) {
  const [open, setOpen] = useState(false)
  if (!isExpandableMiss(item)) return null

  // A collapsed line lists its parties in `details`; a single one names its party only through the
  // candidates map. Both reach the same expansion.
  const names = item.details ?? Object.keys(item.meshCandidates ?? {})
  const n = names.length
  const isPort = isMeshPortCollapsed(item)
  // One party with five candidates is asking "which of these", not "which name" — label it by the
  // thing the operator is about to choose from.
  const singleWithCandidates = n === 1 && (item.meshCandidates?.[names[0]!]?.length ?? 0) > 0
  const showLabel = open
    ? isPort
      ? 'Hide ports'
      : singleWithCandidates
        ? 'Hide matches'
        : 'Hide names'
    : isPort
      ? `Show ${n} ports`
      : singleWithCandidates
        ? `Show ${item.meshCandidates![names[0]!]!.length} in Mesh`
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
              {names.map((name) => {
                const candidates = item.meshCandidates?.[name] ?? []
                return (
                  <li key={name} className="text-sm leading-snug text-text-secondary">
                    <span className="font-mono text-text-primary">{name}</span>
                    {candidates.length === 0 ? (
                      <span className="text-text-muted">{rowSuffix}</span>
                    ) : (
                      <>
                        {/* Not "not in Mesh" — Mesh has it, under a longer name, N times over.
                            The operator's question is WHICH, so answer it with the list rather
                            than sending them to a search box for something we already know. */}
                        <span className="text-text-muted">
                          {candidates.length === 1
                            ? ' — in Mesh, not linked:'
                            : ` — ${candidates.length} in Mesh, none named exactly this:`}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {candidates.map((master) =>
                            onPick ? (
                              <button
                                key={master}
                                type="button"
                                disabled={picking === name}
                                onClick={() => onPick(name, master)}
                                data-testid="mesh-candidate-pick"
                                className="rounded border border-border bg-surface-700 px-1.5 py-0.5 text-left font-mono text-xs text-text-primary hover:border-cobalt-primary hover:text-cobalt-primary-light disabled:opacity-40"
                              >
                                {master}
                              </button>
                            ) : (
                              <span
                                key={master}
                                data-testid="mesh-candidate-name"
                                className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-text-secondary"
                              >
                                {master}
                              </span>
                            ),
                          )}
                        </span>
                      </>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </li>
  )
}
