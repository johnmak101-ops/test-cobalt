import { AlertTriangle } from 'lucide-react'
import { Card } from '../ui/Card'
import { toast } from '../ui/Toast'
import { fieldLabel } from '../../lib/review-fields'
import { formatFieldValue } from './ShipmentHistoryTimeline'
import { useResolveContestedLock } from '../../hooks/use-shipments'

interface ContestedLock {
  field: string
  yourValue: string | null
  newValue: string | null
}

/**
 * Surfaces fields where a NEWER email overrode a human edit. The committer applies the fresher value so
 * tracking stays current (no silent staleness); this prompt lets the user keep that value or restore
 * their edit in one click. Resolving refetches the detail, so the row disappears once handled.
 */
export function ContestedLockCard({ shipmentId, locks }: { shipmentId: string; locks: ContestedLock[] }) {
  const resolve = useResolveContestedLock(shipmentId)
  if (locks.length === 0) return null

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle size={16} className="shrink-0 text-status-warning" />
        <h3 className="text-sm font-semibold text-text-primary">
          A newer email changed {locks.length} field{locks.length !== 1 ? 's' : ''} you edited
        </h3>
      </div>
      <p className="mb-3 text-xs text-text-muted">
        The newer value is applied so tracking stays current. Keep it, or restore your edit.
      </p>
      <div className="space-y-2" data-testid="contested-locks">
        {locks.map((c) => {
          const label = fieldLabel(c.field)
          return (
            <div
              key={c.field}
              data-testid={`contested-${c.field}`}
              className="rounded-lg border border-border bg-surface-900/50 p-3"
            >
              <p className="text-sm font-medium text-text-primary">{label}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="text-text-muted">your edit</span>
                <span className="font-medium text-text-secondary line-through">
                  {formatFieldValue(c.field, c.yourValue)}
                </span>
                <span className="text-text-muted">new email</span>
                <span className="font-medium text-cobalt-primary-light">
                  {formatFieldValue(c.field, c.newValue)}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate(
                      { field: c.field, action: 'keep-new' },
                      { onSuccess: () => toast.success(`Kept the new ${label}`) },
                    )
                  }
                  className="rounded-md bg-cobalt-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cobalt-primary-light disabled:opacity-50"
                >
                  Keep new value
                </button>
                <button
                  type="button"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate(
                      { field: c.field, action: 'restore' },
                      { onSuccess: () => toast.success(`Restored your ${label}`) },
                    )
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-700 disabled:opacity-50"
                >
                  Restore my edit
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
