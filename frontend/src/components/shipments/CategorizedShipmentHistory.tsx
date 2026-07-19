import { useMemo, useState } from 'react'
import { Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { groupHistoryByCategory, type HistoryCategoryGroup } from '../../lib/history-grouping'
import { ShipmentHistoryTimeline } from './ShipmentHistoryTimeline'
import type { HistoryEntry } from '../../hooks/use-shipment-history'

/**
 * Change History grouped into the four Order Details sections plus a Status & Lifecycle catch-all,
 * each a collapsible section. Empty categories are omitted; every category timeline reuses
 * ShipmentHistoryTimeline. Sections default collapsed — the counts show what changed at a glance.
 */
export function CategorizedShipmentHistory({ history }: { history: HistoryEntry[] }) {
  const groups = useMemo(() => groupHistoryByCategory(history), [history])

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <Clock size={24} className="mb-2 opacity-50" />
        <p className="text-sm">No changes recorded yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="categorized-history">
      {groups.map((group) => (
        <HistoryCategorySection key={group.category} group={group} />
      ))}
    </div>
  )
}

function HistoryCategorySection({ group }: { group: HistoryCategoryGroup }) {
  const [open, setOpen] = useState(false)
  const { category, entries } = group

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-700/50"
      >
        {open ? (
          <ChevronDown size={15} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronRight size={15} className="shrink-0 text-text-muted" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{category}</span>
        <span className="shrink-0 rounded-full bg-surface-700 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
          {entries.length}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          <ShipmentHistoryTimeline history={entries} />
        </div>
      )}
    </div>
  )
}
