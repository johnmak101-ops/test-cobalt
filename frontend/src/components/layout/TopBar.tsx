import { RefreshCw, BellRing, LogOut } from 'lucide-react'
import { useReconcile } from '../../hooks/use-reconcile'
import { useEvaluateAlerts } from '../../hooks/use-alerts'
import { useAuth } from '../../hooks/use-auth'

export function TopBar() {
  const reconcile = useReconcile()
  const evaluate = useEvaluateAlerts()
  const { user, logout } = useAuth()
  const canMutate = user?.role === 'EDITOR' || user?.role === 'ADMIN'

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface-900/40 px-6">
      <div className="text-sm text-text-secondary">Cobalt Knitwear — shipping tracker</div>
      <div className="flex items-center gap-2">
        {canMutate && (
          <>
            <button
              onClick={() => reconcile.mutate()}
              disabled={reconcile.isPending}
              className="btn btn-surface"
            >
              <RefreshCw size={15} className={reconcile.isPending ? 'animate-spin' : ''} /> Reconcile
            </button>
            <button
              onClick={() => evaluate.mutate()}
              disabled={evaluate.isPending}
              className="btn btn-accent"
            >
              <BellRing size={15} /> Evaluate alerts
            </button>
          </>
        )}
        <div className="flex items-center gap-2 border-l border-border pl-3">
          <span className="text-sm text-text-secondary">
            {user?.name} <span className="text-text-muted">· {user?.role}</span>
          </span>
          <button
            onClick={logout}
            title="Log out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-700 hover:text-text-primary"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </header>
  )
}
