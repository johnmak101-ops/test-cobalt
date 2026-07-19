import { formatDate, formatDateTime } from '../../lib/utils'
import { cn } from '../../lib/utils'
import { fieldLabel } from '../../lib/field-labels'
import { humanizeReason } from '../../lib/review-reasons'
import type { HistoryEntry } from '../../hooks/use-shipment-history'
import {
  Clock,
  Mail,
  User,
  Settings,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'

const sourceIcons = {
  email: Mail,
  manual: User,
  system: Settings,
}

export const sourceLabels = {
  email: 'Email extraction',
  manual: 'Manual edit',
  system: 'System',
}

interface ShipmentHistoryTimelineProps {
  history: HistoryEntry[]
}

export function ShipmentHistoryTimeline({ history }: ShipmentHistoryTimelineProps) {
  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-muted">
        <Clock size={24} className="mb-2 opacity-50" />
        <p className="text-sm">No changes recorded yet</p>
      </div>
    )
  }

  return (
    <div className="relative space-y-0">
      {/* Timeline line */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

      {history.map((entry) => {
        const SourceIcon = sourceIcons[entry.sourceType] ?? Settings

        return (
          <div key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Timeline dot */}
            <div
              className={cn(
                'relative z-10 mt-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border',
                entry.isDelay
                  ? 'border-status-critical/40 bg-status-critical/15'
                  : 'border-border bg-surface-700'
              )}
            >
              {entry.isDelay ? (
                <AlertTriangle size={13} className="text-status-critical" />
              ) : (
                <SourceIcon size={13} className="text-text-muted" />
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">
                  {fieldLabel(entry.field)}
                </span>
                {entry.isDelay && (
                  <span className="rounded bg-status-critical/15 px-1.5 py-0.5 text-[10px] font-semibold text-status-critical">
                    DELAY
                  </span>
                )}
              </div>

              {/* Old → New value */}
              {/* Values can be long comma-joined lists with no spaces (an item/style set), which
                  is one unbreakable word to the layout — min-w-0 lets these flex items shrink and
                  break-words lets the token wrap instead of overflowing. flex-wrap is what keeps a
                  long value from crushing a short sibling ("(empty)") into a 1-char-per-line column. */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="min-w-0 break-words text-text-muted line-through">
                  {formatFieldValue(entry.field, entry.oldValue)}
                </span>
                <ArrowRight size={10} className="shrink-0 text-text-muted" />
                <span className="min-w-0 break-words font-medium text-text-secondary">
                  {formatFieldValue(entry.field, entry.newValue)}
                </span>
              </div>

              {/* Source + time */}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                <span>{sourceLabels[entry.sourceType] ?? entry.sourceType}</span>
                <span>·</span>
                <span className="font-mono">{formatDateTime(entry.changedAt)}</span>
              </div>

              {/* The source email: subject as a clickable link → the reading-pane popup */}
              {entry.notes && entry.sourceType === 'email' && entry.sourceId ? (
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      `/email/${entry.sourceId}?type=`,
                      `email_${entry.sourceId}`,
                      'popup,width=880,height=940,resizable=yes,scrollbars=yes',
                    )
                  }
                  title="Open the source email"
                  className="mt-1 inline-flex max-w-full cursor-pointer items-center gap-1 text-left text-xs italic text-text-muted hover:text-cobalt-primary-light hover:underline"
                >
                  {/* min-w-0: truncate can only ellipsize once the flex item is allowed to shrink */}
                  <span className="min-w-0 truncate">{entry.notes}</span>
                  <ExternalLink size={10} className="shrink-0" />
                </button>
              ) : (
                entry.notes && <HistoryNotes field={entry.field} notes={entry.notes} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Multi-PO audit notes are stored as one semicolon-joined string
 * ("PO A: …; PO B: …"). Render as bullets + plain language when there are 2+.
 */
function HistoryNotes({ field, notes }: { field: string; notes: string }) {
  const items = splitHistoryNotes(notes)
  if (items.length <= 1) {
    return (
      <p className="mt-1 text-xs italic text-text-muted" title={notes}>
        {humanizeHistoryNote(field, notes)}
      </p>
    )
  }
  return (
    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-text-secondary">
      {items.map((raw) => (
        <li key={raw} title={raw}>
          {humanizeHistoryNote(field, raw)}
        </li>
      ))}
    </ul>
  )
}

/** Split "; "-joined multi-PO flags without breaking times like "12:00". */
export function splitHistoryNotes(notes: string): string[] {
  const parts = notes
    .split(/\s*;\s*(?=PO\s|shipment-level\s)/i)
    .map((s) => s.trim())
    .filter(Boolean)
  // Fallback: generic "; " split when the PO-prefix pattern doesn't apply but we still have many clauses
  if (parts.length <= 1 && notes.includes(';')) {
    return notes
      .split(/\s*;\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return parts
}

function humanizeHistoryNote(field: string, note: string): string {
  // PO enrichment / qty conflict notes → same ops language as review reasons
  if (/po_enrichment|po_qty|enrichment|broadcast|conflict/i.test(field) || /broadcast total|PO\s+\S+:/i.test(note)) {
    return humanizeReason(note)
  }
  return note
}

// Leg-column date fields (camelCase, the vocabulary the backend history emits) + legacy snake keys.
const DATE_FIELDS = new Set([
  'etd', 'atd', 'eta', 'ata', 'cargoReadyDate', 'warehouseStartDate', 'warehouseEndDate',
  'cfsCutoff', 'inDcDate', 'cfs_cutoff',
])

export function formatFieldValue(field: string, value: string | null): string {
  if (!value) return '(empty)'

  if (DATE_FIELDS.has(field)) {
    try {
      return formatDate(value)
    } catch {
      return value
    }
  }

  // Status / state / risk: underscores → spaces for readability (AT_WAREHOUSE → AT WAREHOUSE)
  if (field === 'status' || field === 'state' || field === 'reviewStatus' || field === 'risk_level') {
    return value.replace(/_/g, ' ')
  }

  return value
}
