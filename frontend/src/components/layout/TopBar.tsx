import { RefreshCw, BellRing } from 'lucide-react'
import { useReconcile } from '../../hooks/use-reconcile'
import { useEvaluateAlerts } from '../../hooks/use-alerts'

export function TopBar() {
  const reconcile = useReconcile()
  const evaluate = useEvaluateAlerts()

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface-900/40 px-6">
      <div className="text-sm text-text-secondary">Cobalt Knitwear — shipping tracker</div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => reconcile.mutate()}
          disabled={reconcile.isPending}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-800 px-3 py-1.5 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw size={15} className={reconcile.isPending ? 'animate-spin' : ''} /> Reconcile
        </button>
        <button
          onClick={() => evaluate.mutate()}
          disabled={evaluate.isPending}
          className="flex items-center gap-2 rounded-lg border border-cobalt-primary/40 bg-cobalt-primary/15 px-3 py-1.5 text-sm font-medium text-cobalt-primary hover:bg-cobalt-primary/25 disabled:opacity-50"
        >
          <BellRing size={15} /> Evaluate alerts
        </button>
      </div>
    </header>
  )
}
